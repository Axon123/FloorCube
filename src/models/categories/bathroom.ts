import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, glass, modelGroup, pebble, torus } from '../primitives';
import type { FurnitureColor } from '../types';

export function buildToilet(_color: FurnitureColor) {
  const group = modelGroup('toilet');
  cylinder(group, 0.16, 0.2, 0.32, [0, 0.16, 0.02], NEUTRALS.white, 20);
  const bowl = pebble(group, 0.27, [0, 0.37, 0.08], NEUTRALS.white, 2);
  bowl.scale.set(0.78, 0.58, 1.05);
  const seat = torus(group, 0.19, 0.04, [0, 0.48, 0.11], NEUTRALS.white);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1, 1.25, 1);
  box(group, [0.4, 0.42, 0.2], [0, 0.58, -0.24], NEUTRALS.white, 0.055);
  box(group, [0.42, 0.06, 0.22], [0, 0.8, -0.24], NEUTRALS.white, 0.025);
  cylinder(group, 0.025, 0.025, 0.012, [0.1, 0.837, -0.24], NEUTRALS.metal, 12);
  return group;
}

export function buildVanity(color: FurnitureColor) {
  const group = modelGroup('vanity');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.8, 0.72, 0.5], [0, 0.4, 0], palette.wood, 0.035);
  for (const x of [-0.195, 0.195]) {
    box(group, [0.36, 0.62, 0.025], [x, 0.42, 0.26], palette.wood, 0.015);
    box(group, [0.018, 0.16, 0.025], [x + (x < 0 ? 0.12 : -0.12), 0.48, 0.285], NEUTRALS.metal, 0.006);
  }
  box(group, [0.84, 0.07, 0.54], [0, 0.795, 0], NEUTRALS.white, 0.03);
  const basin = pebble(group, 0.27, [0, 0.84, 0.04], NEUTRALS.white, 2);
  basin.scale.set(1.1, 0.3, 0.78);
  cylinder(group, 0.018, 0.018, 0.2, [0, 0.93, -0.19], NEUTRALS.metal, 12);
  const spout = cylinder(group, 0.016, 0.016, 0.14, [0, 1.025, -0.13], NEUTRALS.metal, 12);
  spout.rotation.x = Math.PI / 2;
  return group;
}

export function buildBathtub(_color: FurnitureColor) {
  const group = modelGroup('bathtub');
  box(group, [1.56, 0.1, 0.62], [0, 0.09, 0], NEUTRALS.white, 0.04);
  for (const z of [-0.33, 0.33]) {
    box(group, [1.7, 0.48, 0.11], [0, 0.33, z], NEUTRALS.white, 0.05);
  }
  for (const x of [-0.795, 0.795]) {
    box(group, [0.11, 0.48, 0.58], [x, 0.33, 0], NEUTRALS.white, 0.05);
  }
  box(group, [1.45, 0.025, 0.51], [0, 0.16, 0], NEUTRALS.water, 0.02);
  cylinder(group, 0.022, 0.022, 0.3, [-0.69, 0.64, 0], NEUTRALS.metal, 12);
  const spout = cylinder(group, 0.018, 0.018, 0.18, [-0.61, 0.78, 0], NEUTRALS.metal, 12);
  spout.rotation.z = Math.PI / 2;
  cylinder(group, 0.04, 0.04, 0.025, [-0.78, 0.6, 0.14], NEUTRALS.metal, 12);
  return group;
}

export function buildShower(_color: FurnitureColor) {
  const group = modelGroup('shower');
  box(group, [0.9, 0.09, 0.9], [0, 0.045, 0], NEUTRALS.white, 0.045);
  box(group, [0.78, 0.018, 0.78], [0, 0.1, 0], NEUTRALS.cream, 0.025);
  glass(group, [0.025, 1.9, 0.86], [-0.435, 1.05, 0]);
  glass(group, [0.86, 1.9, 0.025], [0, 1.05, -0.435]);
  for (const y of [0.12, 1.98]) {
    box(group, [0.035, 0.035, 0.9], [-0.435, y, 0], NEUTRALS.metal, 0.008);
    box(group, [0.9, 0.035, 0.035], [0, y, -0.435], NEUTRALS.metal, 0.008);
  }
  for (const z of [-0.435, 0.435]) {
    box(group, [0.035, 1.95, 0.035], [-0.435, 1.05, z], NEUTRALS.metal, 0.008);
  }
  cylinder(group, 0.018, 0.018, 1.7, [0.25, 1.0, -0.39], NEUTRALS.metal, 12);
  const arm = cylinder(group, 0.016, 0.016, 0.26, [0.25, 1.85, -0.27], NEUTRALS.metal, 12);
  arm.rotation.x = Math.PI / 2;
  cylinder(group, 0.11, 0.09, 0.035, [0.25, 1.82, -0.14], NEUTRALS.metal, 20);
  cylinder(group, 0.055, 0.055, 0.025, [0, 0.118, 0], NEUTRALS.metal, 16);
  return group;
}
