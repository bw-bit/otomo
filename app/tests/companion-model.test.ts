import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createCompanion } from "@/three/companionModel";
import { traitsFromSeed } from "@/three/traits";

it("shows a thinking tilt and settles safely after petting and a happy hop", () => {
  const model = createCompanion(traitsFromSeed("sora.otomo.eth"));
  model.setMood("thinking");
  model.update(1, 1 / 60);
  expect(model.group.rotation.z).toBeCloseTo(0.1);
  model.poke(new Vector3(0, 0, 1));
  model.setStretch(new Vector3(0.2, 0.1, 0));
  model.hop();
  model.squash(0.18);
  model.setMood("talking");
  for (let i = 0; i < 240; i++) model.update(1 + i / 60, 1 / 60);
  expect(model.group.position.toArray().every(Number.isFinite)).toBe(true);
  expect(model.group.scale.y).toBeGreaterThan(0.8);
  expect(model.group.scale.y).toBeLessThan(1.2);
  model.dispose();
});
