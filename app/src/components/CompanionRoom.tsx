"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createCompanion, hsl, type CompanionModel } from "@/three/companionModel";
import { createPetting, petLine, type PetTarget } from "@/three/petting";
import { createSparkles } from "@/three/sparkles";
import { mulberry32, seedToInt, traitsFromSeed } from "@/three/traits";

export interface RoomCompanion {
  label: string;
  full_name: string;
  role: string;
}

interface Props {
  companions: RoomCompanion[];
  current: string;
  onSelect: (label: string) => void;
  /** Latest assistant line, shown as a speech bubble over the current companion. */
  bubble?: string;
  thinking?: boolean;
  className?: string;
}

const ROLE_TAG: Record<string, string> = { personal: "くらし", work: "しごと" };
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface Rec {
  info: RoomCompanion;
  model: CompanionModel;
  shadow: THREE.Mesh;
  target: THREE.Vector3; // where this companion wants to stand (x/z)
  scaleTarget: number;
  scale: number;
  tag: HTMLDivElement;
  nextIdle: number;
  glanceUntil: number;
  glanceX: number;
}

/** Siblings stand slightly behind and to the sides; the current one is front-center. */
const SIBLING_SLOTS = [
  [-1.7, -0.55],
  [1.7, -0.55],
  [-2.9, -0.95],
  [2.9, -0.95],
] as const;

export function CompanionRoom({ companions, current, onSelect, bubble, thinking, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ companions, current, onSelect, bubble, thinking });
  propsRef.current = { companions, current, onSelect, bubble, thinking };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 0.7, 6.2);

    // Soft round floor: a radial-gradient disc, like a rug under the pets.
    const floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color("#6b537f") } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 3.2) * 0.85; gl_FragColor = vec4(uColor, a); }`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.04;
    floor.scale.set(1.4, 1, 0.62);
    scene.add(floor);
    const floorGeo = floor.geometry;

    const shadowMat = () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uOpacity: { value: 0.5 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity; varying vec2 vUv;
          void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 4.5) * uOpacity; gl_FragColor = vec4(0.04, 0.03, 0.09, a); }`,
      });

    const sparkles = createSparkles();
    sparkles.setPixelRatio(renderer.getPixelRatio());
    scene.add(sparkles.points);

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "roombubble";
    host.appendChild(bubbleEl);

    const petBubbles = new Set<HTMLDivElement>();
    const spawnPetBubble = (world: THREE.Vector3) => {
      const p = world.clone().add(new THREE.Vector3(0, 0.75, 0)).project(camera);
      const r = host.getBoundingClientRect();
      const el = document.createElement("div");
      el.className = "petbubble";
      el.textContent = petLine();
      el.style.left = `${((p.x + 1) / 2) * r.width}px`;
      el.style.top = `${((1 - p.y) / 2) * r.height}px`;
      host.appendChild(el);
      petBubbles.add(el);
      window.setTimeout(() => {
        el.remove();
        petBubbles.delete(el);
      }, 1300);
    };

    let records: Rec[] = [];
    let buildKey = "";
    let swapping = false;

    const slotFor = (info: RoomCompanion, index: number): { pos: THREE.Vector3; scale: number } =>
      info.label === propsRef.current.current
        ? { pos: new THREE.Vector3(0, 0, 0.55), scale: 1 }
        : { pos: new THREE.Vector3(SIBLING_SLOTS[index % SIBLING_SLOTS.length][0], 0, SIBLING_SLOTS[index % SIBLING_SLOTS.length][1]), scale: 0.8 };

    const rebuild = () => {
      for (const r of records) {
        scene.remove(r.model.group, r.shadow);
        r.model.dispose();
        (r.shadow.material as THREE.Material).dispose();
        r.tag.remove();
      }
      records = [];
      let sib = 0;
      for (const info of propsRef.current.companions) {
        const model = createCompanion(traitsFromSeed(info.full_name));
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), shadowMat());
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -1.02;
        const slot = slotFor(info, sib);
        if (info.label !== propsRef.current.current) sib++;
        model.group.position.set(slot.pos.x, 0, slot.pos.z);
        model.group.scale.setScalar(slot.scale);
        scene.add(model.group, shadow);
        const tag = document.createElement("div");
        tag.className = "roomtag";
        tag.innerHTML = `<b></b> <span></span>`;
        tag.querySelector("b")!.textContent = info.label;
        tag.querySelector("span")!.textContent = `· ${ROLE_TAG[info.role] ?? info.role}`;
        host.appendChild(tag);
        const idle = mulberry32(seedToInt(info.label));
        records.push({
          info,
          model,
          shadow,
          target: slot.pos,
          scaleTarget: slot.scale,
          scale: slot.scale,
          tag,
          nextIdle: 3 + idle() * 6,
          glanceUntil: -1,
          glanceX: 0,
        });
      }
    };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = camera.aspect < 0.75 ? 8.4 : 6.2;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const petting = createPetting({
      dom: renderer.domElement,
      camera,
      targets: (): PetTarget[] => records.map((r) => ({ object: r.model.group, model: r.model })),
      onTap: (t, world) => {
        sparkles.burst(world.clone().add(new THREE.Vector3(0, 0.75, 0)));
        spawnPetBubble(world);
        const rec = records.find((r) => r.model === t.model);
        if (rec && rec.info.label !== propsRef.current.current && !swapping) {
          swapping = true;
          const cur = records.find((r) => r.info.label === propsRef.current.current);
          // Walk the picked sibling forward while the current one steps aside.
          const tmp = cur?.target.clone();
          if (cur) {
            cur.target.copy(rec.target);
            cur.scaleTarget = 0.8;
          }
          rec.target.set(0, 0, 0.55);
          rec.scaleTarget = 1;
          void tmp;
          window.setTimeout(() => propsRef.current.onSelect(rec.info.label), reduced ? 350 : 900);
        }
      },
    });

    const clock = new THREE.Clock();
    const worldV = new THREE.Vector3();
    const screenV = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const t = clock.elapsedTime;
      const p = propsRef.current;

      const key = `${p.companions.map((c) => c.label).join(",")}|${p.current}`;
      if (key !== buildKey) {
        buildKey = key;
        swapping = false;
        rebuild();
      }

      const hostRect = host.getBoundingClientRect();
      const project = (world: THREE.Vector3) => {
        screenV.copy(world).project(camera);
        return {
          x: ((screenV.x + 1) / 2) * hostRect.width,
          y: ((1 - screenV.y) / 2) * hostRect.height,
        };
      };

      for (const r of records) {
        const isCur = r.info.label === p.current;
        // Walk toward the slot; scale eases with it.
        r.model.group.position.x = damp(r.model.group.position.x, r.target.x, 4, dt);
        r.model.group.position.z = damp(r.model.group.position.z, r.target.z, 4, dt);
        r.scale = damp(r.scale, r.scaleTarget, 4, dt);
        r.model.update(t, dt);
        r.model.group.scale.multiplyScalar(r.scale);

        // Sibling idle life: deterministic-ish glances and the occasional hop.
        if (!isCur && !swapping) {
          r.nextIdle -= dt;
          if (r.nextIdle <= 0) {
            r.nextIdle = 5 + mulberry32(seedToInt(r.info.label) + Math.floor(t))() * 7;
            if (Math.floor(t * 7919 + r.info.label.length) % 3 === 0) r.model.hop();
            else {
              r.glanceUntil = t + 0.9;
              r.glanceX = Math.sign(-r.model.group.position.x) * 0.7;
            }
          }
          if (t < r.glanceUntil) r.model.setLook(r.glanceX, 0.15);
        }

        // Thinking sway on the current companion.
        r.model.group.rotation.z = isCur && p.thinking ? Math.sin(t * 3.2) * 0.05 : damp(r.model.group.rotation.z, 0, 6, dt);

        // Contact shadow follows the feet; it tightens when the pet hops.
        r.shadow.position.x = r.model.group.position.x;
        r.shadow.position.z = r.model.group.position.z;
        const lift = Math.max(0, r.model.group.position.y + 0.06);
        r.shadow.scale.setScalar(r.scale * Math.max(0.6, 1 - lift * 0.55));
        (r.shadow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.5 * Math.max(0.35, 1 - lift * 0.8);

        // Name tag under each companion.
        r.model.group.getWorldPosition(worldV);
        worldV.y -= 1.18 * r.scale;
        const tagPos = project(worldV);
        r.tag.style.left = `${tagPos.x}px`;
        r.tag.style.top = `${tagPos.y}px`;
      }

      petting.update(dt);
      sparkles.update(dt);

      // Speech bubble over the current companion: latest assistant line, or "…" while thinking.
      const cur = records.find((r) => r.info.label === p.current);
      if (cur) {
        const text = p.thinking ? "…" : p.bubble ?? "";
        if (bubbleEl.textContent !== text) bubbleEl.textContent = text;
        bubbleEl.classList.toggle("show", text.length > 0);
        cur.model.group.getWorldPosition(worldV);
        worldV.y += 1.45;
        const b = project(worldV);
        bubbleEl.style.left = `${b.x}px`;
        bubbleEl.style.top = `${b.y}px`;
      }

      camera.position.x = damp(camera.position.x, petting.pointer.x * 0.4, 3, dt);
      camera.position.y = damp(camera.position.y, 0.7 + petting.pointer.y * 0.25, 3, dt);
      camera.lookAt(0, -0.05, 0);

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      petting.dispose();
      for (const r of records) {
        r.model.dispose();
        r.shadow.geometry.dispose();
        (r.shadow.material as THREE.Material).dispose();
        r.tag.remove();
      }
      records = [];
      sparkles.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      bubbleEl.remove();
      for (const el of petBubbles) el.remove();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
