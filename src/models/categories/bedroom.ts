import type { Group } from 'three';
import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, modelGroup } from '../primitives';
import type { FurnitureColor } from '../types';

function buildBed(id: string, width: number, color: FurnitureColor): Group {
  const group = modelGroup(id);
  const palette = FURNITURE_PALETTES[color];
  const depth = 2;
  const halfWidth = width / 2;

  for (const x of [-halfWidth + 0.1, halfWidth - 0.1]) {
    for (const z of [-0.85, 0.85]) {
      box(group, [0.09, 0.18, 0.09], [x, 0.09, z], palette.wood, 0.015);
    }
  }
  box(group, [width, 0.22, depth], [0, 0.24, 0], palette.wood, 0.045);
  box(group, [width - 0.08, 0.22, depth - 0.1], [0, 0.43, 0.02], NEUTRALS.cream, 0.075);
  box(group, [width, 0.95, 0.1], [0, 0.61, -0.95], palette.wood, 0.04);
  box(group, [width - 0.12, 0.64, 0.055], [0, 0.66, -0.885], palette.fabric, 0.025);

  const pillowWidth = width > 1.2 ? width * 0.38 : width * 0.72;
  const pillowXs = width > 1.2 ? [-width * 0.23, width * 0.23] : [0];
  for (const x of pillowXs) {
    const pillow = box(group, [pillowWidth, 0.14, 0.42], [x, 0.59, -0.58], NEUTRALS.white, 0.065);
    pillow.rotation.x = -0.08;
  }
  box(group, [width - 0.1, 0.07, 1.05], [0, 0.575, 0.4], palette.fabric, 0.035);
  box(group, [width - 0.1, 0.28, 0.06], [0, 0.46, 0.91], palette.fabric, 0.02);
  box(group, [width - 0.16, 0.018, 0.07], [0, 0.62, -0.02], palette.accent, 0.005);
  return group;
}

export function buildDoubleBed(color: FurnitureColor) {
  return buildBed('bed-double', 1.8, color);
}

export function buildSingleBed(color: FurnitureColor) {
  return buildBed('bed-single', 1.05, color);
}

export function buildWardrobe(color: FurnitureColor) {
  const group = modelGroup('wardrobe');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.6, 2.06, 0.6], [0, 1.05, 0], palette.wood, 0.035);
  box(group, [1.64, 0.06, 0.62], [0, 2.07, 0], palette.wood, 0.018);
  for (const x of [-0.395, 0.395]) {
    box(group, [0.75, 1.94, 0.035], [x, 1.06, 0.31], palette.wood, 0.018);
    box(group, [0.022, 0.28, 0.035], [x + (x < 0 ? 0.29 : -0.29), 1.08, 0.345], NEUTRALS.metal, 0.008);
  }
  box(group, [1.5, 0.08, 0.5], [0, 0.06, 0], NEUTRALS.dark, 0.01);
  return group;
}

export function buildNightstand(color: FurnitureColor) {
  const group = modelGroup('nightstand');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.17, 0.17]) {
    for (const z of [-0.14, 0.14]) {
      box(group, [0.045, 0.12, 0.045], [x, 0.06, z], palette.wood, 0.01);
    }
  }
  box(group, [0.45, 0.4, 0.4], [0, 0.32, 0], palette.wood, 0.035);
  box(group, [0.38, 0.15, 0.025], [0, 0.39, 0.205], palette.wood, 0.012);
  box(group, [0.38, 0.15, 0.025], [0, 0.21, 0.205], palette.wood, 0.012);
  box(group, [0.12, 0.018, 0.025], [0, 0.39, 0.23], NEUTRALS.metal, 0.006);
  box(group, [0.47, 0.045, 0.42], [0, 0.535, 0], palette.wood, 0.018);
  return group;
}

export function buildDesk(color: FurnitureColor) {
  const group = modelGroup('desk');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.2, 0.07, 0.6], [0, 0.735, 0], palette.wood, 0.025);
  for (const x of [-0.53, 0.53]) {
    for (const z of [-0.23, 0.23]) {
      box(group, [0.055, 0.7, 0.055], [x, 0.35, z], palette.wood, 0.012);
    }
  }
  box(group, [0.4, 0.18, 0.48], [0.34, 0.62, 0], palette.wood, 0.018);
  box(group, [0.35, 0.12, 0.025], [0.34, 0.63, 0.25], palette.wood, 0.008);
  box(group, [0.1, 0.016, 0.025], [0.34, 0.63, 0.27], NEUTRALS.metal, 0.005);
  return group;
}
