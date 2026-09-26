import * as THREE from "three";
import type { CompanionModel } from "./companionModel";

export interface PetTarget {
  /** Root object to raycast against (the companion group). */
  object: THREE.Object3D;
  model: CompanionModel;
}

export interface Petting {
  /** Which target is under the pointer, if any. */
  hovered(): PetTarget | null;
  /** Current pointer NDC, for camera parallax. */
  pointer: THREE.Vector2;
  update(dt: number): void;
  dispose(): void;
}

const TAP_MS = 280;
const TAP_MOVE = 0.06; // ndc distance
const MAX_STRETCH = 0.42;
const PET_LINES = ["えへへ", "くすぐったい〜", "なあに？", "もっとなでて", "ぷよん"];

/**
 * Raycaster-based petting shared by the birth and room scenes: hover = lean + gaze,
 * press = squash + dent, drag = jelly stretch, release = rebound wobble, tap = hop + bubble.
 */
export function createPetting(opts: {
  dom: HTMLElement;
  camera: THREE.Camera;
  targets: () => PetTarget[];
  /** Sparkle motes + speech bubble on a quick tap, in world space. */
  onTap?: (target: PetTarget, worldPoint: THREE.Vector3) => void;
}): Petting {
  const { dom, camera } = opts;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const grabLocal = new THREE.Vector3();
  const hitV = new THREE.Vector3();
  const local = new THREE.Vector3();
  const down = { active: false, at: 0, x: 0, y: 0, target: null as PetTarget | null, dragged: false };
  let hover: PetTarget | null = null;

  const ndc = (e: PointerEvent) => {
    const r = dom.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };

  const pick = (): { target: PetTarget; point: THREE.Vector3 } | null => {
    raycaster.setFromCamera(pointer, camera);
    for (const t of opts.targets()) {
      const hit = raycaster.intersectObject(t.object, true)[0];
      if (hit) return { target: t, point: hit.point };
    }
    return null;
  };

  const onMove = (e: PointerEvent) => {
    ndc(e);
    if (down.active && down.target) {
      e.preventDefault(); // only while dragging on the canvas — page scroll works elsewhere
      if (Math.hypot(pointer.x - down.x, pointer.y - down.y) > TAP_MOVE) down.dragged = true;
      if (down.dragged) {
        // Local-space delta between the grab point and the current hit on a camera-facing plane.
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(dragPlane, hitV)) {
          local.copy(down.target.object.worldToLocal(hitV)).sub(grabLocal);
          local.z = 0;
          if (local.length() > MAX_STRETCH) local.setLength(MAX_STRETCH);
          down.target.model.setStretch(local);
        }
      }
      return;
    }
    const found = pick();
    hover = found?.target ?? null;
    if (found) {
      found.target.model.setLook(pointer.x, pointer.y);
      dom.style.cursor = "grab";
    } else {
      for (const t of opts.targets()) t.model.setLook(pointer.x * 0.4, pointer.y * 0.4);
      dom.style.cursor = "";
    }
  };

  const onDown = (e: PointerEvent) => {
    ndc(e);
    const found = pick();
    if (!found) return;
    down.active = true;
    down.at = performance.now();
    down.x = pointer.x;
    down.y = pointer.y;
    down.target = found.target;
    down.dragged = false;
    dom.style.cursor = "grabbing";
    found.target.model.squash(0.18); // y 0.82, x/z ~1.1
    found.target.model.poke(found.target.object.worldToLocal(found.point.clone()));
    grabLocal.copy(found.target.object.worldToLocal(found.point.clone()));
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(hitV).negate(),
      found.point, // anchor the plane at the grab point in world space
    );
  };

  const onUp = () => {
    if (!down.active) return;
    down.active = false;
    dom.style.cursor = hover ? "grab" : "";
    const t = down.target;
    down.target = null;
    if (!t) return;
    t.model.setStretch(new THREE.Vector3());
    t.model.squash(0.1); // rebound wobble
    const quick = performance.now() - down.at < TAP_MS && !down.dragged;
    if (quick) {
      t.model.hop();
      opts.onTap?.(t, t.object.getWorldPosition(new THREE.Vector3()));
    }
  };

  const onLeave = () => {
    hover = null;
    for (const t of opts.targets()) t.model.setLook(0, 0);
    dom.style.cursor = "";
  };

  dom.addEventListener("pointermove", onMove, { passive: false });
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointerup", onUp);
  dom.addEventListener("pointercancel", onUp);
  dom.addEventListener("pointerleave", onLeave);

  return {
    hovered: () => hover,
    pointer,
    update() {
      // Siblings keep following the pointer gently even when it is over another companion.
      for (const t of opts.targets()) if (t !== hover && t !== down.target) t.model.setLook(pointer.x * 0.4, pointer.y * 0.4);
    },
    dispose() {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("pointerleave", onLeave);
      dom.style.cursor = "";
    },
  };
}

export const petLine = (rand: () => number = Math.random) => PET_LINES[Math.floor(rand() * PET_LINES.length)];
