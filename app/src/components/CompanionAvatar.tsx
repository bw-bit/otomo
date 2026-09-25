"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createCompanion } from "@/three/companionModel";
import { traitsFromSeed } from "@/three/traits";

/** The same seed → the same companion as the birth scene, shown idle (breathing + blinking). */
export function CompanionAvatar({ seed, className }: { seed: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0.2, 5.6);
    camera.lookAt(0, 0, 0);
    const companion = createCompanion(traitsFromSeed(seed));
    scene.add(companion.group);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 1 / 20);
      companion.update(clock.elapsedTime, dt);
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      companion.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [seed]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
