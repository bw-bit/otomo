/** Deterministic, seed-derived appearance: the same seed always yields the same companion. */

export type EarType = "none" | "round" | "pointy" | "antenna";

export interface CompanionTraits {
  hue: number; // 0..1 main body hue
  accentHue: number; // 0..1 rim / particle accent
  saturation: number;
  earType: EarType;
  squash: number; // body height/width ratio
  eyeGap: number;
  eyeSize: number;
  eyeHeight: number; // negative = lower on the face (reads younger / cuter)
  blush: boolean;
  wobble: number; // body surface wobble amplitude
  orbitCount: number; // small orbiting motes after birth
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the seed string; accepts hex (0x...) or any text such as an ENS name. */
export function seedToInt(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const EARS: EarType[] = ["none", "round", "pointy", "antenna"];

export function traitsFromSeed(seed: string): CompanionTraits {
  const r = mulberry32(seedToInt(seed));
  const hue = r();
  // Accent sits 90-150° away so rim light never muddies into the body color.
  const accentHue = (hue + 0.25 + r() * 0.17) % 1;
  return {
    hue,
    accentHue,
    saturation: 0.45 + r() * 0.25,
    earType: EARS[Math.floor(r() * EARS.length)],
    squash: 0.86 + r() * 0.18,
    eyeGap: 0.34 + r() * 0.1,
    eyeSize: 0.1 + r() * 0.035,
    eyeHeight: -0.02 - r() * 0.1,
    blush: r() > 0.35,
    wobble: 0.025 + r() * 0.03,
    orbitCount: 3 + Math.floor(r() * 4),
  };
}

export const NEUTRAL_TRAITS: CompanionTraits = {
  hue: 0.58,
  accentHue: 0.83,
  saturation: 0.35,
  earType: "none",
  squash: 0.95,
  eyeGap: 0.38,
  eyeSize: 0.11,
  eyeHeight: -0.06,
  blush: false,
  wobble: 0.03,
  orbitCount: 4,
};
