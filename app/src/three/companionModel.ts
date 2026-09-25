import * as THREE from "three";
import type { CompanionTraits } from "./traits";

/**
 * A soft "spirit" companion: big round body, low wide-set eyes (baby schema), optional ears.
 * Toon shading with 3 bands + a thin fresnel rim in the accent color. No textures, no lights needed.
 */

const bodyVertex = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 p = position;
  // Low-frequency wobble only: high frequencies read as "jelly glitch", not "alive".
  float w = sin(p.y * 3.1 + uTime * 1.3) * 0.5 + sin(p.x * 2.3 - uTime * 0.9) * 0.5;
  p += normal * w * uWobble;
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
  /** 0..1 appearance (scale-in with overshoot is applied by the caller). */
  setOpacity(o: number): void;
  setGlow(g: number): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

export function hsl(h: number, s: number, l: number) {
  return new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace);
}

export function createCompanion(traits: CompanionTraits): CompanionModel {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const bodyMat = track(
    new THREE.ShaderMaterial({
      vertexShader: bodyVertex,
      fragmentShader: bodyFragment,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uWobble: { value: traits.wobble },
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
  if (earGeo) {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, bodyMat);
      const y = traits.squash * (traits.earType === "antenna" ? 1.18 : 0.82);
      ear.position.set(side * (traits.earType === "antenna" ? 0.28 : 0.55), y, 0);
      ear.rotation.z = -side * (traits.earType === "pointy" ? 0.35 : 0.2);
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
  group.add(mouth);

  const baseEyeY = traits.eyeSize * 1.15;
  let nextBlink = 1.5;
  let blinkT = -1;

  return {
    group,
    setOpacity(o) {
      bodyMat.uniforms.uOpacity.value = o;
      eyeMat.opacity = o;
      hiMat.opacity = o;
      blushMat.opacity = 0.65 * o;
    },
    setGlow(g) {
      bodyMat.uniforms.uGlow.value = g;
    },
    update(t, dt) {
      bodyMat.uniforms.uTime.value = t;
      // Breathing: never fully still, otherwise it reads as frozen.
      const breath = Math.sin(t * 1.6) * 0.018;
      group.scale.set(1 + breath, 1 - breath, 1 + breath);
      group.position.y = Math.sin(t * 0.8) * 0.06;
      group.rotation.y = Math.sin(t * 0.35) * 0.18;
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
