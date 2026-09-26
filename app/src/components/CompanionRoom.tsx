"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { t as translate, type Lang, type UiKey } from "@/lib/i18n";
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
  onSelect: (label: string) => Promise<void>;
  /** Latest assistant line, shown as a speech bubble over the current companion. */
  bubble?: string;
  thinking?: boolean;
  className?: string;
  lang: Lang;
}

const ROLE_TAG_KEY: Record<string, UiKey> = { personal: "roleTagPersonal", work: "roleTagWork" };
const PET_LINE_KEY: Record<string, UiKey> = {
  "えへへ": "petHappy",
  "くすぐったい〜": "petTicklish",
  "なあに？": "petWhat",
  "もっとなでて": "petMore",
  "ぷよん": "petBoing",
};
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
  tagText: string;
}

/** World-space half-width of a companion incl. breathing room, per render scale. */
const RADIUS_CURRENT = 1.25;
const RADIUS_SIBLING = 1.0;
const SLOT_GAP = 0.55;

export function CompanionRoom({ companions, current, onSelect, bubble, thinking, className, lang }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ companions, current, onSelect, bubble, thinking, lang });
  propsRef.current = { companions, current, onSelect, bubble, thinking, lang };

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

    // Soft oval rug: a warm radial-gradient disc that grounds the whole group.
    const floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uInner: { value: new THREE.Color("#8f6d92") }, uOuter: { value: new THREE.Color("#463a66") } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uInner; uniform vec3 uOuter; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          vec3 col = mix(uInner, uOuter, smoothstep(0.15, 1.0, d));
          float a = exp(-d * d * 2.4) * 0.95;
          gl_FragColor = vec4(col, a);
        }`,
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
    const bubbleTextEl = document.createElement("span");
    bubbleTextEl.className = "roombubble-copy";
    bubbleEl.appendChild(bubbleTextEl);
    host.appendChild(bubbleEl);

    const petBubbles = new Set<HTMLDivElement>();
    const spawnPetBubble = (world: THREE.Vector3) => {
      const p = world.clone().add(new THREE.Vector3(0, 0.75, 0)).project(camera);
      const r = host.getBoundingClientRect();
      const el = document.createElement("div");
      el.className = "petbubble";
      const reaction = petLine();
      el.textContent = translate(PET_LINE_KEY[reaction] ?? "petHappy", propsRef.current.lang);
      const px = ((p.x + 1) / 2) * r.width;
      const py = ((1 - p.y) / 2) * r.height;
      el.style.left = `${Math.min(Math.max(px, 44), r.width - 44)}px`;
      el.style.top = `${Math.max(py, 34)}px`;
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
    let disposed = false;
    let swapTimer: number | undefined;
    let framed = false;
    let lastBubble = "";
    let talkUntil = 0;

    /** Siblings alternate left/right of the current pet, spaced by radius + gap so they never overlap. */
    const slots = () => {
      const map = new Map<string, { pos: THREE.Vector3; scale: number }>();
      const list = propsRef.current.companions;
      const portrait = (host.clientWidth || 1) / (host.clientHeight || 1) < 0.75;
      const sibScale = portrait && list.length > 2 ? 0.72 : 0.8;
      for (const info of list) {
        if (info.label === propsRef.current.current) {
          map.set(info.label, { pos: new THREE.Vector3(0, 0, 0.55), scale: 1 });
        }
      }
      const others = list.filter((c) => c.label !== propsRef.current.current);
      const perSide = [0, 0];
      others.forEach((info, i) => {
        const side = i % 2 === 0 ? -1 : 1; // left, right, left, right…
        const li = perSide[i % 2]++;
        const x = side * (RADIUS_CURRENT + SLOT_GAP + RADIUS_SIBLING * sibScale + li * (2 * RADIUS_SIBLING * sibScale + SLOT_GAP));
        const z = -0.55 - li * 0.35;
        map.set(info.label, { pos: new THREE.Vector3(x, 0, z), scale: sibScale });
      });
      return map;
    };

    const rebuild = () => {
      const wanted = new Set(propsRef.current.companions.map(c => c.full_name));
      for (const r of records.filter(r => !wanted.has(r.info.full_name))) {
        scene.remove(r.model.group, r.shadow);
        r.model.dispose();
        r.shadow.geometry.dispose();
        (r.shadow.material as THREE.Material).dispose();
        r.tag.remove();
      }
      records = records.filter(r => wanted.has(r.info.full_name));
      const slotMap = slots();
      for (const info of propsRef.current.companions) {
        const existing = records.find(r => r.info.full_name === info.full_name);
        if (existing) {
          existing.info = info;
          existing.target.copy(slotMap.get(info.label)!.pos);
          existing.scaleTarget = slotMap.get(info.label)!.scale;
          continue;
        }
        const model = createCompanion(traitsFromSeed(info.full_name));
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), shadowMat());
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -1.02;
        const slot = slotMap.get(info.label)!;
        model.group.position.set(slot.pos.x, 0, slot.pos.z);
        model.group.scale.setScalar(slot.scale);
        scene.add(model.group, shadow);
        const tag = document.createElement("div");
        tag.className = "roomtag";
        tag.innerHTML = `<b></b> <span></span>`;
        tag.querySelector("b")!.textContent = info.label;
        const roleKey = ROLE_TAG_KEY[info.role];
        const roleText = roleKey ? translate(roleKey, propsRef.current.lang) : info.role;
        tag.querySelector("span")!.textContent = `· ${roleText}`;
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
          tagText: roleText,
        });
      }
    };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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
        if (rec && rec.info.label !== propsRef.current.current && !swapping && !propsRef.current.thinking) {
          swapping = true;
          const cur = records.find((r) => r.info.label === propsRef.current.current);
          // Walk the picked sibling forward while the current one steps aside.
          if (cur) {
            cur.target.copy(rec.target);
            cur.scaleTarget = rec.scaleTarget;
          }
          rec.target.set(0, 0, 0.55);
          rec.scaleTarget = 1;
          swapTimer = window.setTimeout(async () => {
            try { await propsRef.current.onSelect(rec.info.label); }
            finally { if (!disposed) { swapping = false; rebuild(); } }
          }, reduced ? 350 : 900);
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
      if ((p.bubble ?? "") !== lastBubble) {
        lastBubble = p.bubble ?? "";
        talkUntil = t + Math.min(5, lastBubble.length * 0.05);
      }

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
        const roleKey = ROLE_TAG_KEY[r.info.role];
        const roleText = roleKey ? translate(roleKey, p.lang) : r.info.role;
        if (r.tagText !== roleText) {
          r.tag.querySelector("span")!.textContent = `· ${roleText}`;
          r.tagText = roleText;
        }
        // Walk toward the slot; scale eases with it.
        r.model.group.position.x = damp(r.model.group.position.x, r.target.x, 4, dt);
        r.model.group.position.z = damp(r.model.group.position.z, r.target.z, 4, dt);
        r.scale = damp(r.scale, r.scaleTarget, 4, dt);
        r.model.setMood(isCur && p.thinking ? "thinking" : isCur && t < talkUntil ? "talking" : "idle");
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
        if (isCur && p.thinking && !reduced) r.model.group.rotation.z += Math.sin(t * 3.2) * 0.035;

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

      // Fit every companion in view: distance comes from the group's total width and the aspect.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const totalHalf = records.reduce((m, r) => Math.max(m, Math.abs(r.target.x) + RADIUS_SIBLING * r.scaleTarget), RADIUS_CURRENT) + 0.4;
      const distW = totalHalf / (tanHalf * Math.max(camera.aspect, 0.3));
      const distH = 1.65 / tanHalf;
      const fit = Math.max(5.4, distW, distH);
      camera.position.z = framed ? damp(camera.position.z, fit, 3, dt) : fit;
      framed = true;
      floor.scale.x = (totalHalf + 1.9) / 4.6;

      // Speech bubble over the current companion: latest assistant line, or "…" while thinking.
      const cur = records.find((r) => r.info.label === p.current);
      if (cur) {
        const text = p.thinking ? "…" : p.bubble ?? "";
        if (bubbleTextEl.textContent !== text) bubbleTextEl.textContent = text;
        bubbleEl.classList.toggle("show", text.length > 0);
        cur.model.group.getWorldPosition(worldV);
        worldV.y += 1.45;
        const b = project(worldV);
        // Keep the bubble inside the room: top ≥ 8px, horizontally within the viewport.
        const bw = bubbleEl.offsetWidth || 120;
        const bh = bubbleEl.offsetHeight || 48;
        bubbleEl.style.left = `${Math.min(Math.max(b.x, bw / 2 + 8), hostRect.width - bw / 2 - 8)}px`;
        bubbleEl.style.top = `${Math.max(b.y, bh + 8)}px`;
      }

      camera.position.x = damp(camera.position.x, petting.pointer.x * 0.4, 3, dt);
      camera.position.y = damp(camera.position.y, 0.7 + petting.pointer.y * 0.25, 3, dt);
      camera.lookAt(0, -0.05, 0);

      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      window.clearTimeout(swapTimer);
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
