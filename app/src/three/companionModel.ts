import * as THREE from "three";
import type { CompanionTraits } from "./traits";

/**
 * A soft "spirit" companion: big round body, low wide-set eyes (baby schema), optional ears.
 * Toon shading with 3 bands + a thin fresnel rim in the accent color. No textures, no lights needed.
 */

const bodyVertex = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform vec3 uPoke;
uniform float uPokeAmount;
uniform vec3 uStretch;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 p = position;
  // Low-frequency wobble only: high frequencies read as "jelly glitch", not "alive".
  float w = sin(p.y * 3.1 + uTime * 1.3) * 0.5 + sin(p.x * 2.3 - uTime * 0.9) * 0.5;
  p += normal * w * uWobble;
  // Press dent: a gaussian dimple around the touched point, spring-driven by uPokeAmount.
  p -= normal * uPokeAmount * 0.28 * exp(-dot(position - uPoke, position - uPoke) * 6.0);
  // Jelly drag: the top follows uStretch while the base (p.y=-1) stays planted.
  p += uStretch * (p.y + 1.0) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const bodyFragment = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uRim;
uniform float uGlow;
uniform float uOpacity;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 n = normalize(vNormalV);
  // Key light from front-top-left so the whole face sits in the lit band.
  vec3 l = normalize(vec3(-0.25, 0.55, 0.8));
  float d = dot(n, l);
  // 3-band toon ramp with a narrow smoothstep: crisp like cel shading, but no stair-step aliasing.
  float band = mix(0.5, 0.74, smoothstep(-0.32, -0.26, d));
  band = mix(band, 1.0, smoothstep(0.2, 0.26, d));
  vec3 col = mix(uShade, uBase, band);
  float fres = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.0);
  col += uRim * fres * 0.55;
  col += uBase * uGlow;
  gl_FragColor = vec4(col, uOpacity);
}`;

export interface CompanionModel {
  group: THREE.Group;
  /** Body mesh, for raycasting + converting hits into poke-space. */
  body: THREE.Mesh;
  /** 0..1 appearance (scale-in with overshoot is applied by the caller). */
  setOpacity(o: number): void;
  setGlow(g: number): void;
  /** Press a dent at a body-local point (unit-sphere space). */
  poke(localPoint: THREE.Vector3): void;
  /** Drag-stretch vector in body-local space; the caller clamps it. */
  setStretch(v: THREE.Vector3): void;
  /** Eyes/mouth/group lean toward the pointer, x/y in -1..1. */
  setLook(x: number, y: number): void;
  /** One happy jump, sprung back down. */
  hop(): void;
  /** Squash pose (0.18 ≈ scale y 0.82, x/z 1.1) that springs back. */
  squash(amount: number): void;
  setMood(mood: "idle" | "thinking" | "talking" | "happy"): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

export function hsl(h: number, s: number, l: number) {
  return new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
}

// Underdamped spring: k 170 / damping 8.5 gives 2-3 visible wobbles, then settles.
const SPRING_K = 170;
const SPRING_C = 8.5;
const spring = (init = 0) => ({ v: init, vel: 0 });
const stepSpring = (s: { v: number; vel: number }, target: number, dt: number, reduced: boolean) => {
  if (reduced) {
    s.v += (target - s.v) * (1 - Math.exp(-10 * dt));
    s.vel = 0;
    return;
  }
  s.vel += (SPRING_K * (target - s.v) - SPRING_C * s.vel) * dt;
  s.v += s.vel * dt;
};

export function createCompanion(traits: CompanionTraits): CompanionModel {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const bodyMat = track(
    new THREE.ShaderMaterial({
      vertexShader: bodyVertex,
      fragmentShader: bodyFragment,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uWobble: { value: traits.wobble },
        uPoke: { value: new THREE.Vector3(0, 0, 1) },
        uPokeAmount: { value: 0 },
        uStretch: { value: new THREE.Vector3() },
        uBase: { value: hsl(traits.hue, traits.saturation, 0.78) },
        uShade: { value: hsl((traits.hue + 0.03) % 1, traits.saturation + 0.1, 0.56) },
        uRim: { value: hsl(traits.accentHue, 0.8, 0.7) },
        uGlow: { value: 0 },
        uOpacity: { value: 1 },
      },
    }),
  );

  const body = new THREE.Mesh(track(new THREE.SphereGeometry(1, 64, 48)), bodyMat);
  body.scale.set(1, traits.squash, 0.92);
  group.add(body);

  // Ears share the body material so they never look pasted on.
  const earGeo =
    traits.earType === "round"
      ? track(new THREE.SphereGeometry(0.28, 24, 16))
      : traits.earType === "pointy"
        ? track(new THREE.ConeGeometry(0.22, 0.5, 24))
        : traits.earType === "antenna"
          ? track(new THREE.SphereGeometry(0.1, 16, 12))
          : null;
  const ears: { mesh: THREE.Mesh; rest: number; side: number }[] = [];
  if (earGeo) {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, bodyMat);
      const y = traits.squash * (traits.earType === "antenna" ? 1.18 : 0.82);
      ear.position.set(side * (traits.earType === "antenna" ? 0.28 : 0.55), y, 0);
      ear.rotation.z = -side * (traits.earType === "pointy" ? 0.35 : 0.2);
      ears.push({ mesh: ear, rest: ear.rotation.z, side });
      group.add(ear);
      if (traits.earType === "antenna") {
        const stalk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8)), bodyMat);
        stalk.position.set(side * 0.24, traits.squash * 1.03, 0);
        stalk.rotation.z = -side * 0.25;
        group.add(stalk);
      }
    }
  }

  // Eyes: dark ellipsoids with one highlight each. Placed below the body's equator.
  const eyeMat = track(new THREE.MeshBasicMaterial({ color: hsl(traits.hue, 0.35, 0.12), transparent: true }));
  const hiMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  const eyeGeo = track(new THREE.SphereGeometry(1, 24, 16));
  const eyes: THREE.Mesh[] = [];
  const eyeBase: THREE.Vector3[] = [];
  // Face features sit on the front surface of the (squashed) ellipsoid, pushed out past the wobble
  // so they never sink into the body when it breathes or turns.
  const surfaceZ = (x: number, y: number) =>
    Math.sqrt(Math.max(0.01, 1 - x * x - (y / traits.squash) ** 2)) * 0.92 + traits.wobble + 0.012;
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    const x = side * traits.eyeGap * 0.5 * 1.6;
    const y = traits.eyeHeight * traits.squash;
    eye.position.set(x, y, surfaceZ(x, y) - traits.eyeSize * 0.3);
    eye.scale.set(traits.eyeSize * 0.8, traits.eyeSize * 1.15, traits.eyeSize * 0.5);
    const hi = new THREE.Mesh(eyeGeo, hiMat);
    hi.scale.setScalar(0.32);
    hi.position.set(-0.35, 0.4, 0.8);
    eye.add(hi);
    group.add(eye);
    eyes.push(eye);
    eyeBase.push(eye.position.clone());
  }

  const blushMat = track(
    // Saturated pink: a pale pink over cool (green/blue) bodies mixes into gray.
    new THREE.MeshBasicMaterial({ color: hsl(0.97, 0.9, 0.72), transparent: true, opacity: 0.65, depthWrite: false }),
  );
  if (traits.blush) {
    const g = track(new THREE.CircleGeometry(0.09, 20));
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(g, blushMat);
      const x = side * (traits.eyeGap * 0.8 + 0.16);
      const y = (traits.eyeHeight - 0.13) * traits.squash;
      cheek.position.set(x, y, surfaceZ(x, y));
      cheek.lookAt(cheek.position.clone().multiplyScalar(2));
      cheek.scale.set(1.3, 0.8, 1);
      group.add(cheek);
    }
  }

  // Small smile arc between and below the eyes.
  const mouthGeo = track(new THREE.TorusGeometry(0.055, 0.012, 8, 24, Math.PI));
  const mouth = new THREE.Mesh(mouthGeo, eyeMat);
  const my = (traits.eyeHeight - 0.14) * traits.squash;
  mouth.position.set(0, my, surfaceZ(0, my) - 0.004);
  mouth.rotation.z = Math.PI;
  const mouthBase = mouth.position.clone();
  group.add(mouth);

  const baseEyeY = traits.eyeSize * 1.15;
  let nextBlink = 1.5 + traits.hue * 2.5;
  let blinkT = -1;

  // Jelly state: squash scale (per axis), poke dent amount, hop height, gaze.
  const sx = spring(1), sy = spring(1), sz = spring(1);
  const pokeAmt = spring(0);
  const hopY = spring(0);
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let mood: "idle" | "thinking" | "talking" | "happy" = "idle";
  let delight = 0;
  let surprise = 0;
  let opacity = 1;

  return {
    group,
    body,
    setOpacity(o) {
      opacity = o;
      bodyMat.uniforms.uOpacity.value = o;
      eyeMat.opacity = o;
      hiMat.opacity = o;
      blushMat.opacity = 0.65 * o;
    },
    setGlow(g) {
      bodyMat.uniforms.uGlow.value = g;
    },
    poke(localPoint) {
      surprise = 0.45;
      bodyMat.uniforms.uPoke.value.copy(localPoint);
      pokeAmt.v = 1;
      pokeAmt.vel = 0;
    },
    setStretch(v) {
      bodyMat.uniforms.uStretch.value.copy(v);
    },
    setLook(x, y) {
      look.tx = Math.max(-1, Math.min(1, x));
      look.ty = Math.max(-1, Math.min(1, y));
    },
    hop() {
      delight = 2.4;
      hopY.vel += reduced ? 0 : 4.2;
      if (reduced) hopY.v = 0.25;
    },
    squash(amount) {
      sy.v = 1 - amount;
      sx.v = sz.v = 1 + amount * 0.6;
      sx.vel = sy.vel = sz.vel = 0;
    },
    setMood(value) { mood = value; },
    update(t, dt) {
      bodyMat.uniforms.uTime.value = t;
      delight = Math.max(0, delight - dt);
      surprise = Math.max(0, surprise - dt);
      const happy = mood === "happy" ? 1 : Math.min(1, delight);
      const curious = mood === "thinking";
      const talking = mood === "talking";

      stepSpring(sx, 1, dt, !!reduced);
      stepSpring(sy, 1, dt, !!reduced);
      stepSpring(sz, 1, dt, !!reduced);
      stepSpring(pokeAmt, 0, dt, !!reduced);
      stepSpring(hopY, 0, dt, !!reduced);
      bodyMat.uniforms.uPokeAmount.value = pokeAmt.v;

      const ease = reduced ? 1 : 1 - Math.exp(-9 * dt);
      look.x += (look.tx - look.x) * ease;
      look.y += (look.ty - look.y) * ease;

      // Breathing: never fully still, otherwise it reads as frozen.
      const breath = reduced ? 0 : Math.sin(t * 1.6) * 0.018;
      group.scale.set((1 + breath) * sx.v, (1 - breath) * sy.v, (1 + breath) * sz.v);
      group.position.y = (reduced ? 0 : Math.sin(t * 0.8) * 0.06) + hopY.v;
      group.rotation.y = (reduced ? 0 : Math.sin(t * 0.35) * 0.18) + look.x * 0.35;
      group.rotation.x = -look.y * 0.12 + (talking && !reduced ? Math.sin(t * 7) * 0.025 : 0);
      group.rotation.z = curious ? 0.10 : happy * (reduced ? 0.04 : Math.sin(t * 5) * 0.07);
      for (const ear of ears) ear.mesh.rotation.z = ear.rest + ear.side * (happy * 0.13 + (reduced ? 0 : Math.sin(t * 3 + ear.side) * 0.045));
      blushMat.opacity = opacity * Math.min(0.95, 0.65 + happy * 0.3);

      for (let i = 0; i < eyes.length; i++) {
        eyes[i].position.x = eyeBase[i].x + look.x * 0.06;
        eyes[i].position.y = eyeBase[i].y + look.y * 0.06;
        const hi = eyes[i].children[0];
        hi.position.x = -0.35 + look.x * 0.12;
        hi.position.y = 0.4 + look.y * 0.12;
      }
      mouth.position.x = mouthBase.x + look.x * 0.05;
      mouth.position.y = mouthBase.y + look.y * 0.05;
      mouth.scale.set(1 + happy * 0.55, surprise > 0 ? 1.8 : talking ? 0.8 + (reduced ? 0.5 : Math.abs(Math.sin(t * 9)) * 1.1) : 1 + happy * 0.2, 1);
      for (let i = 0; i < eyes.length; i++) {
        eyes[i].scale.y = baseEyeY * (surprise > 0 ? 1.22 : 1 - happy * 0.55);
        eyes[i].rotation.z = happy * (i === 0 ? -0.12 : 0.12);
      }

      // Blink every 2.5–5.5s, 140ms close/open.
      nextBlink -= dt;
      if (nextBlink <= 0 && blinkT < 0) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        const k = blinkT < 0.07 ? 1 - blinkT / 0.07 : Math.min(1, (blinkT - 0.07) / 0.07);
        for (const e of eyes) e.scale.y = baseEyeY * Math.max(0.08, k);
        if (blinkT > 0.14) {
          blinkT = -1;
          nextBlink = 2.5 + ((t * 7.13) % 3);
        }
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
