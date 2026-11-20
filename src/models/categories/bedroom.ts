import { BufferGeometry, Float32BufferAttribute, Mesh, type Group } from 'three';
import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, ellipsoid, material, modelGroup, piping, rod, torus, tube } from '../primitives';
import type { FurnitureColor } from '../types';

function pull(parent: Group, x: number, y: number, front: number, length: number, vertical = false) {
  const dx = vertical ? 0 : length / 2;
  const dy = vertical ? length / 2 : 0;
  for (const sign of [-1, 1]) {
    rod(parent, [x + sign * dx, y + sign * dy, front],
      [x + sign * dx, y + sign * dy, front + 0.022], 0.007, NEUTRALS.metal);
  }
  rod(parent, [x - dx, y - dy, front + 0.022],
    [x + dx, y + dy, front + 0.022], 0.007, NEUTRALS.metal);
}

const bedCovers = new Map<number, BufferGeometry>();

function bedCover(parent: Group, width: number, color: number, hemColor: number) {
  const profile = [
    [-0.10, 0.655], [-0.18, 0.677], [-0.255, 0.658], [-0.272, 0.637],
    [-0.23, 0.638], [-0.05, 0.638], [0.15, 0.639], [0.37, 0.637],
    [0.58, 0.636], [0.76, 0.64], [0.85, 0.636], [0.913, 0.62],
    [0.947, 0.56], [0.957, 0.482], [0.963, 0.416],
  ];
  const point = (u: number, row: number): [number, number, number] => {
    const [z, y] = profile[row];
    const x = Math.sin(u * Math.PI / 2) * (width / 2 - 0.025);
    const edge = Math.pow(Math.max(0, (Math.abs(x) - (width / 2 - 0.065)) / 0.04), 2);
    const ripple = Math.sin(u * 10 + z * 6) * 0.005 + Math.cos(u * 17 - z * 4) * 0.003;
    return [x, y - edge * 0.115 + ripple,
      z + Math.sin(u * 8 + 0.5) * 0.009 * (row > 10 ? 1 : 0.4)];
  };
  if (!bedCovers.has(width)) {
    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const columns = 24;
    for (let row = 0; row < profile.length; row += 1) {
      for (let col = 0; col <= columns; col += 1) {
        vertices.push(...point(col / columns * 2 - 1, row));
        uvs.push(col / columns, row / (profile.length - 1));
        if (row < profile.length - 1 && col < columns) {
          const a = row * (columns + 1) + col;
          const b = a + columns + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.shared = true;
    bedCovers.set(width, geometry);
  }
  const cover = new Mesh(bedCovers.get(width)!, material(color, { surface: 'fabric', doubleSided: true }));
  cover.name = 'bed-draped-cover';
  cover.castShadow = cover.receiveShadow = true;
  parent.add(cover);
  for (const row of [0, profile.length - 1]) {
    tube(parent, Array.from({ length: 13 }, (_, i) => point(i / 6 - 1, row)),
      0.003, hemColor, false, { surface: 'fabric' });
  }
}

function buildBed(id: string, width: number, color: FurnitureColor): Group {
  const group = modelGroup(id);
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) {
    for (const z of [-0.79, 0.80]) {
      cylinder(group, 0.039, 0.028, 0.18, [x, 0.09, z], palette.wood, 20);
    }
  }
  box(group, [width - 0.11, 0.035, 1.87], [0, 0.151, 0.015], NEUTRALS.dark, 0.012);
  box(group, [width - 0.02, 0.16, 1.96], [0, 0.245, 0.02], palette.wood, 0.035);
  box(group, [width - 0.07, 0.028, 1.90], [0, 0.329, 0.02], palette.wood, 0.012);
  box(group, [width, 0.92, 0.12], [0, 0.64, -0.94], palette.wood, 0.035);
  const panels = width > 1.2 ? 3 : 2;
  const panelWidth = (width - 0.14 - (panels - 1) * 0.018) / panels;
  for (let index = 0; index < panels; index += 1) {
    const x = (index - (panels - 1) / 2) * (panelWidth + 0.018);
    box(group, [panelWidth, 0.64, 0.075], [x, 0.735, -0.849], palette.fabric, 0.033);
    const seam = piping(group, panelWidth - 0.045, 0.59, [x, 0.735, -0.809], palette.accent, 0.045);
    seam.rotation.x = Math.PI / 2;
  }
  box(group, [width - 0.10, 0.23, 1.80], [0, 0.435, 0.02], NEUTRALS.cream, 0.065, { surface: 'fabric' });
  box(group, [width - 0.105, 0.095, 1.80], [0, 0.564, 0.02], NEUTRALS.white, 0.043, { surface: 'fabric' }).name = 'bed-mattress-topper';
  for (const y of [0.355, 0.558]) {
    piping(group, width - 0.106, 1.792, [0, y, 0.02], NEUTRALS.cream, 0.08);
  }
  const pillowWidth = width > 1.2 ? 0.66 : 0.70;
  const pillowXs = width > 1.2 ? [-0.425, 0.425] : [0];
  for (const x of pillowXs) {
    ellipsoid(group, [pillowWidth, 0.15, 0.42], [x, 0.662, -0.565], NEUTRALS.cream, { surface: 'fabric' });
    const upper = ellipsoid(group, [pillowWidth * 0.94, 0.165, 0.365],
      [x + 0.012, 0.745, -0.565], NEUTRALS.white, { surface: 'fabric' });
    upper.rotation.x = -0.10;
    const seam = tube(group, Array.from({ length: 16 }, (_, i): [number, number, number] => {
      const angle = i / 16 * Math.PI * 2;
      return [Math.cos(angle) * pillowWidth * 0.47, 0, Math.sin(angle) * 0.1825];
    }), 0.0025, NEUTRALS.cream, true, { surface: 'fabric' });
    seam.position.copy(upper.position);
    seam.rotation.copy(upper.rotation);
  }
  bedCover(group, width, palette.fabric, palette.accent);
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
  box(group, [1.47, 0.085, 0.51], [0, 0.0425, -0.025], NEUTRALS.dark, 0.008);
  box(group, [1.57, 0.06, 0.59], [0, 0.095, -0.025], palette.wood, 0.014);
  for (const x of [-0.786, 0.786]) {
    box(group, [0.052, 1.93, 0.58], [x, 1.08, -0.04], palette.wood, 0.013);
  }
  box(group, [1.52, 1.93, 0.026], [0, 1.08, -0.317], palette.wood, 0.006);
  box(group, [1.54, 1.886, 0.02], [0, 1.095, 0.238], NEUTRALS.dark, 0.006);
  box(group, [1.60, 0.032, 0.61], [0, 2.03, -0.025], palette.wood, 0.01);
  box(group, [1.64, 0.055, 0.66], [0, 2.0725, 0], palette.wood, 0.018);
  for (const x of [-0.391, 0.391]) {
    box(group, [0.764, 1.868, 0.037], [x, 1.096, 0.268], palette.wood, 0.009);
    box(group, [0.656, 1.692, 0.012], [x, 1.096, 0.292], palette.wood, 0.016);
    for (const y of [0.211, 1.981]) {
      box(group, [0.698, 0.021, 0.009], [x, y, 0.291], palette.wood, 0.003);
    }
    pull(group, x < 0 ? -0.078 : 0.078, 1.12, 0.298, 0.30, true);
  }
  return group;
}

export function buildNightstand(color: FurnitureColor) {
  const group = modelGroup('nightstand');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.17, 0.17]) {
    for (const z of [-0.15, 0.15]) {
      cylinder(group, 0.023, 0.017, 0.12, [x, 0.06, z], palette.wood, 20);
      cylinder(group, 0.018, 0.017, 0.025, [x, 0.0125, z], NEUTRALS.metal, 20);
    }
  }
  for (const x of [-0.205, 0.205]) {
    box(group, [0.032, 0.397, 0.416], [x, 0.3185, -0.01], palette.wood, 0.008);
  }
  box(group, [0.38, 0.39, 0.02], [0, 0.318, -0.207], palette.wood, 0.005);
  box(group, [0.414, 0.03, 0.416], [0, 0.135, -0.01], palette.wood, 0.007);
  box(group, [0.397, 0.366, 0.016], [0, 0.332, 0.174], NEUTRALS.dark, 0.004);
  for (const y of [0.234, 0.416]) {
    box(group, [0.385, 0.166, 0.023], [0, y, 0.185], palette.wood, 0.009);
    box(group, [0.339, 0.122, 0.006], [0, y, 0.198], palette.wood, 0.006);
    pull(group, 0, y + 0.013, 0.201, 0.108);
  }
  box(group, [0.438, 0.017, 0.43], [0, 0.519, -0.005], NEUTRALS.dark, 0.006);
  box(group, [0.47, 0.035, 0.46], [0, 0.5425, 0], palette.wood, 0.016);
  return group;
}

export function buildDesk(color: FurnitureColor) {
  const group = modelGroup('desk');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.2, 0.05, 0.6], [0, 0.745, 0], palette.wood, 0.023);
  box(group, [1.125, 0.026, 0.53], [0, 0.707, 0], palette.wood, 0.012);
  for (const x of [-0.535, 0.535]) {
    for (const z of [-0.231, 0.231]) {
      cylinder(group, 0.028, 0.019, 0.70, [x, 0.35, z], palette.wood, 20);
      cylinder(group, 0.020, 0.019, 0.025, [x, 0.0125, z], NEUTRALS.metal, 20);
    }
    box(group, [0.028, 0.095, 0.455], [x, 0.652, 0], palette.wood, 0.008);
    rod(group, [x, 0.19, -0.231], [x, 0.19, 0.231], 0.014, palette.wood);
  }
  box(group, [1.07, 0.095, 0.028], [0, 0.652, -0.231], palette.wood, 0.008);
  rod(group, [-0.535, 0.19, -0.231], [0.535, 0.19, -0.231], 0.014, palette.wood);
  box(group, [0.37, 0.16, 0.47], [0.333, 0.617, -0.006], palette.wood, 0.012);
  box(group, [0.347, 0.126, 0.012], [0.333, 0.616, 0.236], NEUTRALS.dark, 0.004);
  box(group, [0.328, 0.11, 0.023], [0.333, 0.616, 0.2535], palette.wood, 0.008);
  box(group, [0.282, 0.074, 0.006], [0.333, 0.616, 0.267], palette.wood, 0.006);
  pull(group, 0.333, 0.63, 0.270, 0.10);
  return group;
}

export function buildDresser(color: FurnitureColor) {
  const group = modelGroup('dresser');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.505, 0.505]) {
    for (const z of [-0.16, 0.16]) {
      cylinder(group, 0.03, 0.021, 0.15, [x, 0.075, z], palette.wood, 20);
      cylinder(group, 0.022, 0.021, 0.028, [x, 0.014, z], NEUTRALS.metal, 20);
    }
  }
  box(group, [1.14, 0.037, 0.438], [0, 0.1585, -0.021], palette.wood, 0.013);
  box(group, [1.10, 0.68, 0.021], [0, 0.518, -0.2295], palette.wood, 0.004);
  for (const x of [-0.565, 0.565]) {
    box(group, [0.035, 0.682, 0.438], [x, 0.518, -0.021], palette.wood, 0.008);
  }
  box(group, [1.115, 0.672, 0.017], [0, 0.515, 0.183], NEUTRALS.dark, 0.004);
  for (const x of [-0.282, 0.282]) {
    for (const y of [0.281, 0.505, 0.729]) {
      box(group, [0.546, 0.207, 0.021], [x, y, 0.1965], palette.wood, 0.009);
      box(group, [0.494, 0.155, 0.006], [x, y, 0.208], palette.wood, 0.008);
      pull(group, x, y + 0.018, 0.211, 0.145);
    }
  }
  box(group, [1.17, 0.018, 0.45], [0, 0.851, -0.012], NEUTRALS.dark, 0.006);
  box(group, [1.2, 0.04, 0.48], [0, 0.88, 0], palette.wood, 0.017);
  return group;
}

export function buildDressingTable(color: FurnitureColor) {
  const group = modelGroup('dressing-table');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.433, 0.433]) {
    for (const z of [-0.18, 0.18]) {
      cylinder(group, 0.027, 0.018, 0.59, [x, 0.295, z], palette.wood, 20);
      cylinder(group, 0.019, 0.018, 0.03, [x, 0.015, z], NEUTRALS.metal, 20);
    }
    box(group, [0.033, 0.17, 0.408], [x, 0.652, -0.017], palette.wood, 0.008);
  }
  box(group, [0.90, 0.032, 0.412], [0, 0.579, -0.016], palette.wood, 0.009);
  box(group, [0.89, 0.15, 0.023], [0, 0.653, -0.210], palette.wood, 0.005);
  box(group, [0.894, 0.135, 0.018], [0, 0.653, 0.187], NEUTRALS.dark, 0.004);
  for (const x of [-0.225, 0.225]) {
    box(group, [0.434, 0.117, 0.02], [x, 0.653, 0.204], palette.wood, 0.009);
    box(group, [0.380, 0.078, 0.006], [x, 0.653, 0.217], palette.wood, 0.006);
    pull(group, x, 0.664, 0.22, 0.113);
    box(group, [0.034, 0.235, 0.036], [x, 0.87, -0.203], palette.wood, 0.01);
  }
  box(group, [1.0, 0.05, 0.5], [0, 0.755, 0], palette.wood, 0.024);
  const backing = cylinder(group, 0.329, 0.329, 0.022, [0, 1.16, -0.209], palette.wood, 48);
  backing.rotation.x = Math.PI / 2;
  backing.scale.x = 0.84;
  const mirror = cylinder(group, 0.319, 0.319, 0.010, [0, 1.16, -0.191], NEUTRALS.metal, 48,
    { surface: 'metal', roughness: 0.08, metalness: 0.9 });
  mirror.rotation.x = Math.PI / 2;
  mirror.scale.x = 0.84;
  const frame = torus(group, 0.327, 0.013, [0, 1.16, -0.184], palette.wood);
  frame.scale.x = 0.84;
  const innerBead = torus(group, 0.315, 0.003, [0, 1.16, -0.176], NEUTRALS.metal);
  innerBead.scale.x = 0.84;
  return group;
}
