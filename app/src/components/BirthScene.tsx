"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createBirthParticles, createFlash } from "@/three/birthParticles";
import { createCompanion, hsl, type CompanionModel } from "@/three/companionModel";
import { createPetting, petLine } from "@/three/petting";
import { createSparkles } from "@/three/sparkles";
import { mulberry32, traitsFromSeed, type CompanionTraits } from "@/three/traits";

export type BirthPhase = "idle" | "verifying" | "forming" | "born" | "failed";

interface Props {
  phase: BirthPhase;
  /** Seed that makes this companion one of a kind (e.g. its ENS name). Required for "born". */
  seed: string | null;
  /** Live preview while a name is being typed: same seed → the reveal matches. */
  previewSeed?: string | null;
  /** Bump on each keystroke to nudge the preview (small jelly bounce). */
  pokeNonce?: number;
  className?: string;
}

// Per-phase targets. Values are eased toward, never snapped, so any phase change reads smoothly.
const TARGETS: Record<BirthPhase, { gather: number; swirlSpeed: number; fail: number }> = {
  idle: { gather: 0, swirlSpeed: 0.12, fail: 0 },
  verifying: { gather: 0.3, swirlSpeed: 0.75, fail: 0 },
  forming: { gather: 1, swirlSpeed: 1.1, fail: 0 },
  born: { gather: 1, swirlSpeed: 0.15, fail: 0 },
  failed: { gather: 0, swirlSpeed: 0.05, fail: 1 },
};

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
// Overshoot once, settle: the "pop" of being born. Kept to a single ~12% overshoot to avoid a rubbery feel.
const easeOutBack = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  const c1 = 1.9;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const PREVIEW_OPACITY = 0.55;
const PREVIEW_GLOW = 0.35;

export function BirthScene({ phase, seed, previewSeed = null, pokeNonce = 0, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const seedRef = useRef(seed);
  const previewSeedRef = useRef(previewSeed);
  const pokeNonceRef = useRef(pokeNonce);
  phaseRef.current = phase;
  seedRef.current = seed;
  previewSeedRef.current = previewSeed;
  pokeNonceRef.current = pokeNonce;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.innerWidth < 768;
    const count = reduced ? 1500 : small ? 3000 : 7000;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // toon colors: keep the palette saturated
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Mid-telephoto framing: avoids wide-angle distortion on the round face.
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.25, 7.2);

    const particles = createBirthParticles(count, mulberry32(0x07a0));
    particles.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    scene.add(particles.points);

    const flash = createFlash();
    flash.mesh.position.z = 0.6;
    scene.add(flash.mesh);

    // Everything the companion owns lives in one rig, framed above the UI panel.
    const rig = new THREE.Group();
    rig.position.y = 0.55;
    let rigScale = 0.74;
    rig.scale.setScalar(rigScale);
    scene.add(rig);
    particles.points.position.copy(rig.position);
    particles.points.scale.copy(rig.scale);
    // The companion must sit in the free area above the form panel, whatever its height.
    const panelEl = host.parentElement?.querySelector<HTMLElement>(".panel") ?? null;

    // Orbiting motes: soft additive points (flat opaque dots read as UI bugs, not light).
    const MAX_MOTES = 8;
    const moteGeo = new THREE.BufferGeometry();
    const motePos = new Float32Array(MAX_MOTES * 3);
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color("#ffffff") }, uOpacity: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `uniform float uPixelRatio; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 26.0 * uPixelRatio * (6.0 / -mv.z); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 6.0); gl_FragColor = vec4(uColor, a * uOpacity); }`,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    rig.add(motes);
    let moteCount = 0;

    const sparkles = createSparkles();
    sparkles.setPixelRatio(renderer.getPixelRatio());
    scene.add(sparkles.points);

    let companion: CompanionModel | null = null;
    let companionSeed: string | null = null;
    let traits: CompanionTraits | null = null;
    let lastPoke = pokeNonceRef.current;

    const mountCompanion = (s: string) => {
      if (companion) {
        rig.remove(companion.group);
        companion.dispose();
      }
      traits = traitsFromSeed(s);
      companion = createCompanion(traits);
      companion.group.scale.setScalar(0);
      companion.setOpacity(0);
      rig.add(companion.group);
      companionSeed = s;
      particles.setSilhouette(traits.squash);
      particles.uniforms.uColorA.value.copy(hsl(traits.hue, 0.7, 0.8));
      particles.uniforms.uColorB.value.copy(hsl(traits.accentHue, 0.75, 0.78));
      moteMat.uniforms.uColor.value.copy(hsl(traits.accentHue, 0.85, 0.72));
      sparkles.setColor(hsl(traits.accentHue, 0.85, 0.78));
      moteCount = Math.min(traits.orbitCount, MAX_MOTES);
      moteGeo.setDrawRange(0, moteCount);
    };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Keep the companion framed on portrait screens by pulling the camera back.
      camera.position.z = camera.aspect < 0.8 ? 9.5 : 7.2;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const spawnPetBubble = (worldPoint: THREE.Vector3) => {
      const p = worldPoint.clone().project(camera);
      const r = host.getBoundingClientRect();
      const el = document.createElement("div");
      el.className = "petbubble";
      el.textContent = petLine();
      el.style.left = `${((p.x + 1) / 2) * r.width}px`;
      el.style.top = `${((1 - p.y) / 2) * r.height - 70}px`;
      host.appendChild(el);
      window.setTimeout(() => el.remove(), 1300);
    };

    const petting = createPetting({
      dom: renderer.domElement,
      camera,
      targets: () => {
        const c = companion as CompanionModel | null;
        return phaseRef.current === "born" && c ? [{ object: c.group, model: c }] : [];
      },
      onTap: (_t, worldPoint) => {
        sparkles.burst(worldPoint.clone().add(new THREE.Vector3(0, 0.7, 0)));
        spawnPetBubble(worldPoint);
      },
    });

    const s = { gather: 0, swirl: 0, swirlSpeed: 0.12, fail: 0, fade: 0, burst: 0, appear: 0, bornAt: -1, lastPhase: phaseRef.current as BirthPhase };
    const clock = new THREE.Clock();

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const t = clock.elapsedTime;
      const ph = phaseRef.current;

      // The preview keeps the same seed the born companion will use, so the reveal matches.
      const mountSeed =
        ph === "born" || ph === "forming"
          ? (seedRef.current ?? previewSeedRef.current)
          : ph === "idle" || ph === "verifying" || ph === "failed"
            ? previewSeedRef.current
            : null;
      if (mountSeed && mountSeed !== companionSeed) mountCompanion(mountSeed);
      if (!mountSeed && companion) {
        rig.remove(companion.group);
        companion.dispose();
        companion = null;
        companionSeed = null;
      }
      if (pokeNonceRef.current !== lastPoke) {
        lastPoke = pokeNonceRef.current;
        if (companion && ph !== "born") {
          companion.squash(0.1);
          companion.poke(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 1));
        }
      }

      if (ph !== s.lastPhase) {
        if (ph === "born") s.bornAt = t;
        if (ph !== "born") s.bornAt = -1;
        s.lastPhase = ph;
      }

      const tg = TARGETS[ph];
      s.gather = damp(s.gather, tg.gather, ph === "forming" ? 1.6 : 2.2, dt);
      s.swirlSpeed = damp(s.swirlSpeed, tg.swirlSpeed, 1.5, dt);
      s.swirl += s.swirlSpeed * dt;
      s.fail = damp(s.fail, tg.fail, 3, dt);

      // Birth timeline (seconds after entering "born").
      const tb = s.bornAt >= 0 ? t - s.bornAt : -1;
      const burstDur = reduced ? 0.01 : 1.1;
      s.burst = tb >= 0 ? easeOutCubic(tb / burstDur) : damp(s.burst, 0, 4, dt);
      s.fade = tb >= 0 ? easeOutCubic((tb - 0.2) / 1.6) : damp(s.fade, 0, 3, dt);
      const flashI = tb >= 0 && !reduced ? Math.exp(-Math.pow((tb - 0.12) / 0.16, 2)) * 1.1 : 0;
      flash.set(flashI);

      const u = particles.uniforms;
      u.uTime.value = t;
      u.uSwirl.value = s.swirl;
      u.uGather.value = s.gather;
      u.uBurst.value = s.burst;
      u.uFade.value = s.fade;
      u.uFail.value = s.fail;

      const c = companion as CompanionModel | null;
      if (c) {
        const previewing = ph === "idle" || ph === "verifying" || ph === "failed" || ph === "forming";
        if (previewing) {
          // Translucent, gently pulsing silhouette: the ghost of the companion to come.
          const pulse = ph === "forming" ? Math.sin(t * 5.2) * 0.03 : Math.sin(t * 2.4) * 0.02;
          s.appear = damp(s.appear, 1 + pulse, 5, dt);
          c.setOpacity(PREVIEW_OPACITY + (ph === "forming" ? Math.sin(t * 5.2) * 0.08 : 0));
          c.setGlow(PREVIEW_GLOW + (ph === "forming" ? Math.sin(t * 5.2) * 0.15 : 0));
          s.bornAt = -1;
        } else {
          s.appear = tb >= 0 ? (reduced ? Math.min(1, tb / 0.4) : easeOutBack((tb - 0.08) / 0.9)) : damp(s.appear, 0, 6, dt);
          c.setOpacity(Math.min(1, Math.max(s.appear, 0) * 1.4));
          c.setGlow(tb >= 0 ? Math.exp(-tb * 2.2) * 0.6 : 0);
        }
        const k = s.appear;
        // Faster pulse while forming makes the silhouette feel eager.
        c.update(ph === "forming" ? t * 1.8 : t, dt);
        c.group.scale.multiplyScalar(Math.max(k, 0));
      }

      petting.update(dt);
      sparkles.update(dt);

      moteMat.uniforms.uOpacity.value = tb >= 0 ? easeOutCubic((tb - 0.6) / 0.8) * 0.85 : damp(moteMat.uniforms.uOpacity.value, 0, 5, dt);
      for (let i = 0; i < moteCount; i++) {
        const a = t * (0.5 + i * 0.07) + (i / moteCount) * Math.PI * 2;
        const r = 1.6 + 0.12 * Math.sin(t * 1.3 + i);
        motePos.set([Math.cos(a) * r, Math.sin(a * 0.7 + i) * 0.4, Math.sin(a) * r * 0.6], i * 3);
      }
      moteGeo.attributes.position.needsUpdate = true;

      // Keep the rig centered in the visible band between the top of the screen and the panel.
      const hostH = host.clientHeight || 1;
      const freeTop = panelEl ? panelEl.getBoundingClientRect().top : hostH;
      const visibleH = Math.max(140, Math.min(freeTop, hostH));
      const shiftPx = Math.min(Math.max((hostH - visibleH) / 2, 0), hostH * 0.3);
      const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z) / hostH;
      rig.position.y = damp(rig.position.y, 0.55 + shiftPx * worldPerPx, 4, dt);
      rigScale = damp(rigScale, 0.74 * Math.max(0.5, Math.min(1, visibleH / (hostH * 0.55))), 4, dt);
      rig.scale.setScalar(rigScale);
      particles.points.position.copy(rig.position);
      particles.points.scale.copy(rig.scale);

      // Subtle parallax only; the camera never orbits on its own.
      camera.position.x = damp(camera.position.x, petting.pointer.x * 0.35, 3, dt);
      camera.position.y = damp(camera.position.y, 0.25 + petting.pointer.y * 0.2, 3, dt);
      camera.lookAt(0, 0.3, 0);
      flash.mesh.quaternion.copy(camera.quaternion);
      flash.mesh.position.y = rig.position.y;

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      petting.dispose();
      particles.dispose();
      flash.dispose();
      sparkles.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      (companion as CompanionModel | null)?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      host.querySelectorAll(".petbubble").forEach((el) => el.remove());
    };
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
