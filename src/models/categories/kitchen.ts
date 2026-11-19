import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, modelGroup, torus } from '../primitives';
import type { FurnitureColor } from '../types';

export function buildDiningTable(color: FurnitureColor) {
  const group = modelGroup('dining-table');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.4, 0.075, 0.8], [0, 0.7125, 0], palette.wood, 0.04);
  for (const x of [-0.57, 0.57]) {
    for (const z of [-0.28, 0.28]) {
      box(group, [0.07, 0.68, 0.07], [x, 0.34, z], palette.wood, 0.014);
    }
  }
  return group;
}

export function buildDiningChair(color: FurnitureColor) {
  const group = modelGroup('dining-chair');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.18, 0.18]) {
    for (const z of [-0.18, 0.18]) {
      box(group, [0.04, 0.44, 0.04], [x, 0.22, z], palette.wood, 0.009);
    }
  }
  box(group, [0.45, 0.07, 0.45], [0, 0.455, 0], palette.wood, 0.025);
  box(group, [0.39, 0.06, 0.39], [0, 0.515, 0.015], palette.fabric, 0.025);
  for (const x of [-0.18, 0.18]) {
    box(group, [0.04, 0.43, 0.04], [x, 0.7, -0.19], palette.wood, 0.009);
  }
  box(group, [0.43, 0.25, 0.055], [0, 0.78, -0.19], palette.wood, 0.025);
  return group;
}

export function buildFridge(color: FurnitureColor) {
  const group = modelGroup('fridge');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.7, 1.8, 0.7], [0, 0.9, 0], NEUTRALS.cream, 0.055);
  box(group, [0.65, 1.12, 0.04], [0, 1.2, 0.355], palette.fabric, 0.035);
  box(group, [0.65, 0.53, 0.04], [0, 0.355, 0.355], palette.fabric, 0.035);
  box(group, [0.025, 0.42, 0.035], [0.24, 1.16, 0.395], NEUTRALS.metal, 0.009);
  box(group, [0.025, 0.23, 0.035], [0.24, 0.38, 0.395], NEUTRALS.metal, 0.009);
  box(group, [0.58, 0.025, 0.58], [0, 0.025, 0], NEUTRALS.dark, 0.01);
  return group;
}

export function buildKitchenCabinet(color: FurnitureColor) {
  const group = modelGroup('kitchen-cabinet');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.8, 0.82, 0.6], [0, 0.44, 0], palette.wood, 0.025);
  box(group, [1.84, 0.06, 0.64], [0, 0.88, 0], NEUTRALS.cream, 0.018);
  box(group, [1.64, 0.1, 0.48], [0, 0.08, 0.02], NEUTRALS.dark, 0.008);
  for (const x of [-0.58, 0, 0.58]) {
    box(group, [0.54, 0.66, 0.025], [x, 0.47, 0.31], palette.wood, 0.015);
    box(group, [0.18, 0.018, 0.025], [x, 0.72, 0.335], NEUTRALS.metal, 0.006);
  }
  return group;
}

export function buildStove(color: FurnitureColor) {
  const group = modelGroup('stove');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.6, 0.86, 0.6], [0, 0.45, 0], NEUTRALS.cream, 0.03);
  box(group, [0.6, 0.055, 0.61], [0, 0.9, 0], NEUTRALS.dark, 0.015);
  box(group, [0.48, 0.43, 0.025], [0, 0.42, 0.31], NEUTRALS.dark, 0.025);
  box(group, [0.39, 0.32, 0.015], [0, 0.42, 0.33], NEUTRALS.metal, 0.018);
  box(group, [0.42, 0.025, 0.035], [0, 0.68, 0.345], NEUTRALS.metal, 0.008);
  for (const x of [-0.15, 0.15]) {
    for (const z of [-0.15, 0.15]) {
      const burner = torus(group, 0.09, 0.012, [x, 0.934, z], NEUTRALS.metal);
      burner.rotation.x = Math.PI / 2;
      cylinder(group, 0.055, 0.055, 0.014, [x, 0.932, z], NEUTRALS.dark, 16);
    }
  }
  for (const x of [-0.2, -0.067, 0.067, 0.2]) {
    const knob = cylinder(group, 0.027, 0.027, 0.035, [x, 0.79, 0.325], palette.accent, 12);
    knob.rotation.x = Math.PI / 2;
  }
  return group;
}
