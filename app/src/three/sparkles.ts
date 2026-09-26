import * as THREE from "three";

/** Tiny additive sparkle bursts: a handful of points that pop, drift and fade (~0.7s). */
export function createSparkles(max = 12) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color("#ffe9c9") },
      uPixelRatio: { value: 1 },
      uSize: { value: 30 },
    },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio; uniform float uSize;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * uPixelRatio * (6.0 / -mv.z); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 7.0); gl_FragColor = vec4(uColor, a * uOpacity); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const base = new THREE.Vector3();
  const dir: THREE.Vector3[] = [];
  let age = -1;

  return {
    points,
    setColor(c: THREE.Color) {
      mat.uniforms.uColor.value.copy(c);
    },
    setPixelRatio(r: number) {
      mat.uniforms.uPixelRatio.value = r;
    },
    burst(at: THREE.Vector3, rand: () => number = Math.random) {
      base.copy(at);
      dir.length = 0;
      for (let i = 0; i < max; i++) {
        const v = new THREE.Vector3(rand() - 0.5, rand() - 0.2, rand() - 0.5).normalize().multiplyScalar(0.5 + rand() * 0.9);
        dir.push(v);
      }
      age = 0;
    },
    update(dt: number) {
      if (age < 0) return;
      age += dt;
      const k = Math.min(age / 0.7, 1);
      for (let i = 0; i < dir.length; i++) {
        const p = base.clone().addScaledVector(dir[i], k * (1 - k * 0.25));
        p.y += k * 0.25;
        pos.set([p.x, p.y, p.z], i * 3);
      }
      geo.attributes.position.needsUpdate = true;
      mat.uniforms.uOpacity.value = (1 - k) * 0.9;
      if (k >= 1) age = -1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
