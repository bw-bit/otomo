import * as THREE from "three";

/**
 * Birth particles. Every state is closed-form in the vertex shader (uniforms only, no per-frame
 * CPU buffer writes), so particle count scales with GPU, not JS.
 *   uSwirl  accumulated swirl angle (idle drift → vortex while verifying)
 *   uGather 0..1 dust converges onto the companion's silhouette (staggered per particle)
 *   uBurst  0..1 release outward at the moment of birth
 *   uFade   0..1 dims the dust after birth so the companion stays the focus
 *   uFail   0..1 dust scatters and cools down when verification is rejected
 */

const vertex = /* glsl */ `
attribute vec3 aTarget;
attribute vec3 aSeed; // x: arrival stagger, y: speed/burst reach, z: color mix
uniform float uTime;
uniform float uSwirl;
uniform float uGather;
uniform float uBurst;
uniform float uFade;
uniform float uFail;
uniform float uPixelRatio;
uniform float uSize;
varying float vMix;
varying float vAlpha;

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }

void main() {
  float r = length(position.xz);
  // Inner dust turns faster: reads as a vortex instead of a rigid rotating cloud.
  vec3 cloud = rotY(position, uSwirl * (0.6 + aSeed.y) * 1.8 / (0.5 + r));
  cloud.y += sin(uTime * 0.6 + aSeed.x * 6.2831) * 0.12;

  float g = smoothstep(aSeed.x * 0.4, aSeed.x * 0.4 + 0.6, uGather);
  vec3 target = aTarget * (1.0 + 0.035 * sin(uTime * 2.2 + aSeed.x * 6.2831));
  vec3 p = mix(cloud, target, g);

  // Burst: ease already applied on the CPU side; reach varies per particle.
  p += normalize(aTarget + 1e-4) * uBurst * (0.6 + aSeed.y * 2.4);
  p = rotY(p, uBurst * 0.6 * (aSeed.z - 0.5));

  p += (normalize(position + 1e-4) * 1.4 + vec3(0.0, -1.6 * aSeed.y, 0.0)) * uFail;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (0.55 + aSeed.y) * mix(1.0, 0.7, g) * (1.0 + uBurst * 0.6);
  gl_PointSize = size * uPixelRatio * (6.0 / -mv.z);
  vMix = aSeed.z;
  vAlpha = mix(0.45, 0.95, g) * (1.0 - uFade * 0.93) * (1.0 - uFail * 0.6);
}`;

const fragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uFailColor;
uniform float uFail;
varying float vMix;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // Soft core + faint halo: keeps additive blending from blowing out into a white blob.
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  vec3 col = mix(mix(uColorA, uColorB, vMix), uFailColor, uFail * 0.8);
  gl_FragColor = vec4(col, a * vAlpha);
}`;

export interface BirthParticles {
  points: THREE.Points;
  uniforms: {
    uTime: THREE.IUniform<number>;
    uSwirl: THREE.IUniform<number>;
    uGather: THREE.IUniform<number>;
    uBurst: THREE.IUniform<number>;
    uFade: THREE.IUniform<number>;
    uFail: THREE.IUniform<number>;
    uPixelRatio: THREE.IUniform<number>;
    uColorA: THREE.IUniform<THREE.Color>;
    uColorB: THREE.IUniform<THREE.Color>;
  };
  /** Re-targets dust onto a new silhouette (called when the companion's traits become known). */
  setSilhouette(squash: number): void;
  dispose(): void;
}

export function createBirthParticles(count: number, rand: () => number): BirthParticles {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const target = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3);
  const unit = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Nebula: flattened disc with a denser core.
    const rr = 1.2 + Math.pow(rand(), 0.7) * 3.6;
    const a = rand() * Math.PI * 2;
    pos.set([Math.cos(a) * rr, (rand() - 0.5) * 1.6 * (1.4 - rr / 5), Math.sin(a) * rr], i * 3);
    // Fibonacci sphere keeps the silhouette evenly filled (no clumps / bald spots).
    const y = 1 - ((i + 0.5) / count) * 2;
    const rad = Math.sqrt(1 - y * y);
    const phi = i * 2.399963229728653;
    unit.set([Math.cos(phi) * rad, y, Math.sin(phi) * rad], i * 3);
    seed.set([rand(), rand(), rand()], i * 3);
  }

  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const targetAttr = new THREE.BufferAttribute(target, 3);
  geo.setAttribute("aTarget", targetAttr);
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  const setSilhouette = (squash: number) => {
    for (let i = 0; i < count; i++) {
      target[i * 3] = unit[i * 3] * 1.04;
      target[i * 3 + 1] = unit[i * 3 + 1] * 1.04 * squash;
      target[i * 3 + 2] = unit[i * 3 + 2] * 0.96;
    }
    targetAttr.needsUpdate = true;
  };
  setSilhouette(0.95);

  const uniforms = {
    uTime: { value: 0 },
    uSwirl: { value: 0 },
    uGather: { value: 0 },
    uBurst: { value: 0 },
    uFade: { value: 0 },
    uFail: { value: 0 },
    uPixelRatio: { value: 1 },
    uSize: { value: 5.5 },
    uColorA: { value: new THREE.Color("#bcd7ff") },
    uColorB: { value: new THREE.Color("#f3c6ff") },
    uFailColor: { value: new THREE.Color("#6b6f86") },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    points: new THREE.Points(geo, mat),
    uniforms,
    setSilhouette,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Billboard radial flash used once at the moment of birth. */
export function createFlash() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uIntensity: { value: 0 }, uColor: { value: new THREE.Color("#fff4e0") } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 5.0) * uIntensity; gl_FragColor = vec4(uColor, a); }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), mat);
  return {
    mesh,
    set(intensity: number) {
      mat.uniforms.uIntensity.value = intensity;
      mesh.visible = intensity > 0.001;
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
