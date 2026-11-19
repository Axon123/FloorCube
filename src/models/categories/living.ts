import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, modelGroup, pebble, screenMaterial } from '../primitives';
import type { FurnitureColor } from '../types';

export function buildSofa(color: FurnitureColor) {
  const group = modelGroup('sofa');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.94, 0.94]) {
    for (const z of [-0.32, 0.32]) {
      cylinder(group, 0.035, 0.045, 0.12, [x, 0.06, z], palette.wood, 10);
    }
  }
  box(group, [2.04, 0.28, 0.82], [0, 0.25, 0], palette.fabric, 0.07);
  box(group, [1.82, 0.58, 0.2], [0, 0.59, -0.35], palette.fabric, 0.075);
  for (const x of [-0.47, 0.47]) {
    const cushion = box(group, [0.89, 0.18, 0.64], [x, 0.47, 0.06], palette.fabric, 0.07);
    cushion.rotation.x = -0.025;
    const back = box(group, [0.84, 0.43, 0.16], [x, 0.67, -0.23], palette.fabric, 0.06);
    back.rotation.x = -0.12;
  }
  for (const x of [-1.01, 1.01]) {
    box(group, [0.18, 0.48, 0.86], [x, 0.46, 0], palette.fabric, 0.07);
  }
  const pillow = box(group, [0.38, 0.36, 0.13], [-0.69, 0.68, -0.04], palette.accent, 0.06);
  pillow.rotation.z = -0.12;
  return group;
}

export function buildCoffeeTable(color: FurnitureColor) {
  const group = modelGroup('coffee-table');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.1, 0.07, 0.6], [0, 0.395, 0], palette.wood, 0.055);
  box(group, [0.88, 0.035, 0.42], [0, 0.17, 0], palette.wood, 0.018);
  for (const x of [-0.43, 0.43]) {
    for (const z of [-0.2, 0.2]) {
      cylinder(group, 0.026, 0.035, 0.36, [x, 0.18, z], palette.wood, 10);
    }
  }
  return group;
}

export function buildTvConsole(color: FurnitureColor) {
  const group = modelGroup('tv-console');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.13, 0.13]) {
      box(group, [0.05, 0.12, 0.05], [x, 0.06, z], palette.wood, 0.01);
    }
  }
  box(group, [1.8, 0.36, 0.42], [0, 0.29, 0], palette.wood, 0.035);
  for (const x of [-0.56, 0, 0.56]) {
    box(group, [0.52, 0.27, 0.025], [x, 0.3, 0.22], palette.wood, 0.012);
    box(group, [0.12, 0.015, 0.025], [x, 0.36, 0.24], NEUTRALS.metal, 0.005);
  }
  box(group, [0.36, 0.035, 0.22], [0, 0.5, 0], NEUTRALS.dark, 0.015);
  box(group, [0.055, 0.2, 0.055], [0, 0.59, 0], NEUTRALS.dark, 0.012);
  box(group, [1.52, 0.78, 0.075], [0, 0.91, 0], NEUTRALS.dark, 0.035);
  const screen = box(group, [1.43, 0.69, 0.012], [0, 0.91, 0.052], NEUTRALS.dark, 0.02);
  screen.material = screenMaterial();
  return group;
}

export function buildBookshelf(color: FurnitureColor) {
  const group = modelGroup('bookshelf');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.9, 1.8, 0.045], [0, 0.9, -0.14], palette.wood, 0.01);
  for (const x of [-0.425, 0.425]) {
    box(group, [0.05, 1.8, 0.32], [x, 0.9, 0], palette.wood, 0.012);
  }
  const shelfHeights = [0.04, 0.46, 0.89, 1.32, 1.76];
  for (const y of shelfHeights) {
    box(group, [0.84, 0.05, 0.32], [0, y, 0], palette.wood, 0.012);
  }
  const bookColors = [palette.fabric, palette.accent, NEUTRALS.cream, NEUTRALS.leaf];
  const rows = [0.25, 0.68, 1.11, 1.54];
  rows.forEach((y, row) => {
    for (let index = 0; index < 5; index += 1) {
      const height = 0.24 + ((index + row) % 3) * 0.035;
      box(group, [0.085, height, 0.2], [-0.3 + index * 0.13, y - 0.15 + height / 2, 0.035], bookColors[(index + row) % bookColors.length], 0.006);
    }
  });
  return group;
}

export function buildFloorLamp(color: FurnitureColor) {
  const group = modelGroup('floor-lamp');
  const palette = FURNITURE_PALETTES[color];
  cylinder(group, 0.18, 0.2, 0.05, [0, 0.025, 0], NEUTRALS.dark, 20);
  cylinder(group, 0.018, 0.022, 1.38, [0, 0.72, 0], NEUTRALS.metal, 12);
  cylinder(group, 0.18, 0.3, 0.36, [0, 1.41, 0], palette.fabric, 20);
  pebble(group, 0.07, [0, 1.31, 0], NEUTRALS.cream, 1);
  return group;
}
