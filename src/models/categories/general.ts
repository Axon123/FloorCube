import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, modelGroup, pebble } from '../primitives';
import type { FurnitureColor } from '../types';

export function buildPlant(color: FurnitureColor) {
  const group = modelGroup('plant');
  const palette = FURNITURE_PALETTES[color];
  cylinder(group, 0.22, 0.16, 0.34, [0, 0.17, 0], palette.accent, 16);
  cylinder(group, 0.195, 0.195, 0.025, [0, 0.33, 0], NEUTRALS.soil, 16);
  const stems = [
    { x: 0, z: 0, height: 0.68 },
    { x: -0.08, z: 0.03, height: 0.53 },
    { x: 0.09, z: -0.03, height: 0.58 },
  ];
  for (const stem of stems) {
    cylinder(group, 0.012, 0.016, stem.height, [stem.x, 0.33 + stem.height / 2, stem.z], NEUTRALS.leaf, 8);
  }
  const leaves = [
    [-0.17, 0.73, 0.02, 0.23],
    [0.17, 0.79, 0.01, 0.25],
    [0.02, 1.02, 0, 0.25],
    [-0.1, 0.94, -0.11, 0.21],
    [0.14, 0.61, 0.09, 0.2],
    [-0.18, 0.55, -0.06, 0.18],
  ] as const;
  leaves.forEach(([x, y, z, radius], index) => {
    const leaf = pebble(group, radius, [x, y, z], index % 2 ? NEUTRALS.leafLight : NEUTRALS.leaf, 1);
    leaf.scale.set(1.2, 0.8, 0.85);
    leaf.rotation.z = x * 1.8;
  });
  return group;
}

export function buildRug(color: FurnitureColor) {
  const group = modelGroup('rug');
  const palette = FURNITURE_PALETTES[color];
  box(group, [2, 0.025, 1.4], [0, 0.0125, 0], palette.fabric, 0.012);
  for (const x of [-0.91, 0.91]) {
    box(group, [0.045, 0.008, 1.26], [x, 0.029, 0], palette.accent, 0.003);
  }
  for (const z of [-0.61, 0.61]) {
    box(group, [1.86, 0.008, 0.045], [0, 0.029, z], palette.accent, 0.003);
  }
  for (const x of [-0.45, 0, 0.45]) {
    const diamond = box(group, [0.28, 0.009, 0.28], [x, 0.03, 0], NEUTRALS.cream, 0.008);
    diamond.rotation.y = Math.PI / 4;
  }
  return group;
}

export function buildAccentChair(color: FurnitureColor) {
  const group = modelGroup('accent-chair');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.27, 0.27]) {
    for (const z of [-0.26, 0.26]) {
      const leg = box(group, [0.055, 0.34, 0.055], [x, 0.17, z], palette.wood, 0.012);
      leg.rotation.x = z * 0.16;
      leg.rotation.z = -x * 0.16;
    }
  }
  box(group, [0.7, 0.18, 0.68], [0, 0.39, 0], palette.fabric, 0.065);
  box(group, [0.58, 0.12, 0.54], [0, 0.52, 0.04], palette.fabric, 0.055);
  const back = box(group, [0.66, 0.48, 0.16], [0, 0.68, -0.28], palette.fabric, 0.065);
  back.rotation.x = -0.16;
  for (const x of [-0.32, 0.32]) {
    box(group, [0.09, 0.25, 0.6], [x, 0.56, 0], palette.fabric, 0.04);
  }
  return group;
}
