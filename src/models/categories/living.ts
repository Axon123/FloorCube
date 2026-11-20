import { Group } from 'three';
import { FURNITURE_PALETTES, NEUTRALS, type FurniturePalette } from '../palette';
import { box, cylinder, ellipsoid, lathe, modelGroup, piping, rod, screenMaterial, torus, tube } from '../primitives';
import type { FurnitureColor } from '../types';

function metalPull(parent: Group, x: number, y: number, front: number, length: number, vertical = false) {
  const dx = vertical ? 0 : length / 2;
  const dy = vertical ? length / 2 : 0;
  for (const sign of [-1, 1]) {
    rod(parent, [x + sign * dx, y + sign * dy, front],
      [x + sign * dx, y + sign * dy, front + 0.018], 0.006, NEUTRALS.metal);
  }
  rod(parent, [x - dx, y - dy, front + 0.018],
    [x + dx, y + dy, front + 0.018], 0.006, NEUTRALS.metal);
}

function sofaSeat(parent: Group, x: number, z: number, width: number, depth: number, palette: FurniturePalette) {
  box(parent, [width, 0.205, depth], [x, 0.454, z], palette.fabric, 0.095);
  ellipsoid(parent, [width * 0.89, 0.096, depth * 0.86], [x, 0.516, z], palette.fabric);
  piping(parent, width - 0.008, depth - 0.008, [x, 0.465, z], palette.accent, 0.095);
}

function sofaBack(parent: Group, x: number, y: number, z: number, width: number, palette: FurniturePalette) {
  const cushion = new Group();
  cushion.position.set(x, y, z);
  cushion.rotation.x = -0.10;
  parent.add(cushion);
  box(cushion, [width, 0.45, 0.19], [0, 0, 0], palette.fabric, 0.085);
  ellipsoid(cushion, [width * 0.90, 0.40, 0.12], [0, 0.005, 0.058], palette.fabric);
  const seam = piping(cushion, width - 0.075, 0.382, [0, 0, 0.089], palette.accent, 0.07);
  seam.rotation.x = Math.PI / 2;
}

function throwPillow(parent: Group, x: number, y: number, z: number, angle: number, color: number) {
  const pillow = new Group();
  pillow.position.set(x, y, z);
  pillow.rotation.set(-0.13, 0, angle);
  parent.add(pillow);
  box(pillow, [0.315, 0.32, 0.105], [0, 0, 0], color, 0.05);
  ellipsoid(pillow, [0.30, 0.307, 0.13], [0, 0, 0.02], color);
  const seam = piping(pillow, 0.29, 0.294, [0, 0, 0.056], NEUTRALS.cream, 0.06);
  seam.rotation.x = Math.PI / 2;
}

export function buildSofa(color: FurnitureColor) {
  const group = modelGroup('sofa');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.945, 0.945]) {
    for (const z of [-0.32, 0.32]) {
      cylinder(group, 0.033, 0.024, 0.16, [x, 0.08, z], palette.wood, 20);
    }
  }
  box(group, [2.065, 0.095, 0.79], [0, 0.1775, 0], palette.wood, 0.028);
  box(group, [1.985, 0.016, 0.748], [0, 0.230, 0], NEUTRALS.dark, 0.012);
  box(group, [2.05, 0.17, 0.83], [0, 0.307, 0], palette.fabric, 0.055);
  box(group, [1.86, 0.58, 0.18], [0, 0.65, -0.36], palette.fabric, 0.055);
  for (const x of [-0.462, 0.462]) {
    sofaSeat(group, x, 0.095, 0.886, 0.626, palette);
    sofaBack(group, x, 0.701, -0.228, 0.862, palette);
  }
  for (const x of [-1.0, 1.0]) {
    box(group, [0.20, 0.46, 0.90], [x, 0.49, 0], palette.fabric, 0.078);
    ellipsoid(group, [0.186, 0.068, 0.81], [x, 0.701, 0], palette.fabric);
    piping(group, 0.177, 0.834, [x, 0.697, 0], palette.accent, 0.058);
  }
  throwPillow(group, -0.738, 0.684, 0.016, -0.16, palette.accent);
  throwPillow(group, 0.745, 0.669, 0.036, 0.18, palette.fabric);
  return group;
}

export function buildSectionalSofa(color: FurnitureColor) {
  const group = modelGroup('sectional-sofa');
  const palette = FURNITURE_PALETTES[color];
  const feet: [number, number][] = [
    [-1.22, -0.70], [1.22, -0.70], [-1.22, -0.01], [1.22, -0.01],
    [-1.22, 0.727], [-0.46, 0.727],
  ];
  for (const [x, z] of feet) {
    cylinder(group, 0.034, 0.025, 0.16, [x, 0.08, z], palette.wood, 20);
  }
  box(group, [2.68, 0.095, 0.80], [0, 0.1775, -0.375], palette.wood, 0.024);
  box(group, [1.06, 0.095, 0.82], [-0.85, 0.1775, 0.405], palette.wood, 0.025);
  box(group, [2.64, 0.17, 0.83], [0, 0.307, -0.385], palette.fabric, 0.05);
  box(group, [1.06, 0.17, 0.82], [-0.85, 0.307, 0.405], palette.fabric, 0.05);
  box(group, [2.43, 0.60, 0.18], [0, 0.66, -0.735], palette.fabric, 0.06);
  sofaSeat(group, -0.8, 0.073, 0.782, 1.406, palette);
  for (const x of [0, 0.8]) {
    sofaSeat(group, x, -0.282, 0.782, 0.626, palette);
  }
  for (const x of [-0.8, 0, 0.8]) {
    sofaBack(group, x, 0.719, -0.606, 0.765, palette);
  }
  for (const [x, depth, z] of [[-1.3, 1.63, 0.01], [1.3, 0.88, -0.375]]) {
    box(group, [0.20, 0.46, depth], [x, 0.49, z], palette.fabric, 0.075);
    ellipsoid(group, [0.185, 0.068, depth - 0.09], [x, 0.701, z], palette.fabric);
    piping(group, 0.177, depth - 0.07, [x, 0.697, z], palette.accent, 0.058);
  }
  throwPillow(group, -1.07, 0.697, -0.373, -0.15, palette.accent);
  throwPillow(group, 1.07, 0.687, -0.340, 0.16, palette.accent);
  return group;
}

export function buildCoffeeTable(color: FurnitureColor) {
  const group = modelGroup('coffee-table');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.43, 0.43]) {
    for (const z of [-0.205, 0.205]) {
      cylinder(group, 0.030, 0.021, 0.382, [x, 0.191, z], palette.wood, 20);
      cylinder(group, 0.022, 0.021, 0.025, [x, 0.0125, z], NEUTRALS.metal, 20);
    }
    box(group, [0.026, 0.054, 0.407], [x, 0.346, 0], palette.wood, 0.007);
    rod(group, [x, 0.108, -0.205], [x, 0.108, 0.205], 0.012, palette.wood);
  }
  box(group, [0.89, 0.054, 0.023], [0, 0.346, -0.205], palette.wood, 0.007);
  box(group, [0.912, 0.035, 0.442], [0, 0.145, 0], palette.wood, 0.018);
  box(group, [1.044, 0.019, 0.544], [0, 0.372, 0], palette.wood, 0.025);
  box(group, [1.1, 0.043, 0.6], [0, 0.3985, 0], palette.wood, 0.048);
  box(group, [0.977, 0.012, 0.478], [0, 0.424, 0], NEUTRALS.cream, 0.039, { surface: 'stone' });
  for (const [x, y, cover] of [[-0.14, 0.180, palette.fabric], [-0.11, 0.213, palette.accent]]) {
    box(group, [0.27, 0.025, 0.185], [x, y, 0.025], NEUTRALS.cream, 0.003, { surface: 'plain' });
    for (const offset of [-0.014, 0.014]) {
      box(group, [0.284, 0.005, 0.197], [x, y + offset, 0.025], cover, 0.002, { surface: 'plain' });
    }
    box(group, [0.284, 0.029, 0.009], [x, y, 0.120], cover, 0.003, { surface: 'plain' });
  }
  return group;
}

export function buildTvConsole(color: FurnitureColor) {
  const group = modelGroup('tv-console');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.745, 0.745]) {
    for (const z of [-0.16, 0.16]) {
      cylinder(group, 0.026, 0.020, 0.13, [x, 0.065, z], palette.wood, 20);
    }
  }
  box(group, [1.75, 0.034, 0.455], [0, 0.137, -0.0125], palette.wood, 0.012);
  box(group, [1.70, 0.30, 0.025], [0, 0.299, -0.2275], palette.wood, 0.005);
  for (const x of [-0.875, 0.875]) {
    box(group, [0.05, 0.30, 0.455], [x, 0.299, -0.0125], palette.wood, 0.009);
  }
  for (const x of [-0.295, 0.295]) {
    box(group, [0.027, 0.29, 0.413], [x, 0.301, -0.0125], palette.wood, 0.005);
  }
  for (const x of [-0.576, 0.576]) {
    box(group, [0.543, 0.280, 0.014], [x, 0.300, 0.175], NEUTRALS.dark, 0.004);
    box(group, [0.523, 0.266, 0.026], [x, 0.300, 0.193], palette.wood, 0.01);
    box(group, [0.466, 0.206, 0.008], [x, 0.300, 0.212], palette.wood, 0.008);
    metalPull(group, x, 0.371, 0.216, 0.133);
  }
  box(group, [0.563, 0.02, 0.389], [0, 0.291, -0.013], palette.wood, 0.006);
  box(group, [0.40, 0.061, 0.25], [0, 0.1845, 0.022], NEUTRALS.dark, 0.008);
  box(group, [0.17, 0.014, 0.005], [-0.061, 0.188, 0.15], NEUTRALS.metal, 0.003);
  const dial = cylinder(group, 0.012, 0.012, 0.009, [0.151, 0.184, 0.153], NEUTRALS.metal, 20);
  dial.rotation.x = Math.PI / 2;
  box(group, [0.278, 0.028, 0.19], [-0.05, 0.315, 0.02], palette.accent, 0.006, { surface: 'plain' });
  box(group, [1.8, 0.04, 0.48], [0, 0.46, 0], palette.wood, 0.016);
  box(group, [0.41, 0.026, 0.245], [0, 0.493, -0.035], NEUTRALS.dark, 0.012);
  box(group, [0.07, 0.133, 0.055], [0, 0.561, -0.064], NEUTRALS.metal, 0.01);
  box(group, [0.83, 0.42, 0.03], [0, 0.91, -0.078], NEUTRALS.dark, 0.02);
  box(group, [1.52, 0.78, 0.05], [0, 0.91, -0.04], NEUTRALS.dark, 0.024);
  box(group, [1.463, 0.724, 0.008], [0, 0.917, -0.012], NEUTRALS.metal, 0.012);
  const screen = box(group, [1.446, 0.707, 0.006], [0, 0.917, -0.005], NEUTRALS.dark, 0.01);
  screen.material = screenMaterial();
  return group;
}

function standingBook(parent: Group, x: number, base: number, width: number, height: number, color: number) {
  box(parent, [width - 0.012, height - 0.012, 0.194], [x, base + height / 2, 0.006],
    NEUTRALS.cream, 0.002, { surface: 'plain', roughness: 0.88 });
  for (const side of [-1, 1]) {
    box(parent, [0.006, height, 0.222], [x + side * (width / 2 - 0.003), base + height / 2, 0.010],
      color, 0.002, { surface: 'plain', roughness: 0.62 });
  }
  box(parent, [width, height, 0.022], [x, base + height / 2, 0.112], color, 0.005, { surface: 'plain' });
  box(parent, [width * 0.60, height * 0.17, 0.003], [x, base + height * 0.71, 0.124],
    NEUTRALS.cream, 0.001, { surface: 'plain' });
}

export function buildBookshelf(color: FurnitureColor) {
  const group = modelGroup('bookshelf');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.80, 0.08, 0.26], [0, 0.04, -0.012], NEUTRALS.dark, 0.008);
  box(group, [0.804, 1.73, 0.018], [0, 0.918, -0.151], palette.wood, 0.004);
  for (const x of [-0.426, 0.426]) {
    box(group, [0.048, 1.8, 0.32], [x, 0.9, 0], palette.wood, 0.012);
  }
  const shelves = [0.1025, 0.52, 0.9375, 1.355, 1.7825];
  for (const y of shelves) {
    box(group, [0.804, 0.035, 0.294], [0, y, 0.004], palette.wood, 0.007);
    box(group, [0.804, 0.019, 0.016], [0, y - 0.005, 0.151], palette.wood, 0.004);
  }
  const colors = [palette.fabric, palette.accent, NEUTRALS.leaf, palette.wood];
  const rows = [[-0.335, -0.252, -0.157], [-0.301, -0.213], [0.061, 0.151], [-0.076]];
  rows.forEach((xs, row) => {
    xs.forEach((x, index) => {
      standingBook(group, x, shelves[row] + 0.0175, 0.063 + index * 0.009,
        0.262 + ((index + row) % 3) * 0.027, colors[(index + row) % colors.length]);
    });
  });
  for (const [x, y] of [[-0.083, 0.12], [0.223, 0.955]]) {
    box(group, [0.085, 0.008, 0.18], [x - 0.033, y + 0.004, 0.014], NEUTRALS.metal, 0.002);
    box(group, [0.009, 0.181, 0.165], [x, y + 0.09, 0.014], NEUTRALS.metal, 0.003);
  }
  for (const [y, colorValue] of [[0.977, palette.accent], [1.019, palette.fabric]]) {
    box(group, [0.223, 0.032, 0.18], [-0.236, y, 0.012], NEUTRALS.cream, 0.002, { surface: 'plain' });
    for (const side of [-1, 1]) {
      box(group, [0.235, 0.005, 0.19], [-0.236, y + side * 0.018, 0.012], colorValue, 0.002, { surface: 'plain' });
    }
    box(group, [0.235, 0.039, 0.012], [-0.236, y, 0.105], colorValue, 0.003, { surface: 'plain' });
  }
  lathe(group, [[0, 0], [0.046, 0], [0.066, 0.022], [0.073, 0.081], [0.048, 0.145],
    [0.029, 0.17], [0.029, 0.198], [0.022, 0.198], [0.022, 0.17], [0.041, 0.14],
    [0.061, 0.08], [0.051, 0.025], [0, 0.018]], [0.225, 0.5375, 0.012], NEUTRALS.cream,
  { surface: 'ceramic', doubleSided: true });
  box(group, [0.131, 0.018, 0.126], [0.24, 1.3815, 0.01], palette.wood, 0.006);
  const sculpture = torus(group, 0.062, 0.018, [0.24, 1.466, 0.01], NEUTRALS.metal);
  sculpture.rotation.y = -0.27;
  return group;
}

export function buildFloorLamp(color: FurnitureColor) {
  const group = modelGroup('floor-lamp');
  const palette = FURNITURE_PALETTES[color];
  lathe(group, [[0, 0], [0.173, 0], [0.19, 0.012], [0.19, 0.032], [0.176, 0.052],
    [0.044, 0.062], [0, 0.062]], [0, 0, 0], NEUTRALS.dark, { surface: 'metal', roughness: 0.36 });
  const baseBead = torus(group, 0.176, 0.004, [0, 0.051, 0], NEUTRALS.metal);
  baseBead.rotation.x = Math.PI / 2;
  cylinder(group, 0.032, 0.046, 0.036, [0, 0.072, 0], NEUTRALS.metal);
  cylinder(group, 0.012, 0.014, 1.185, [0, 0.6525, 0], NEUTRALS.metal, 24);
  lathe(group, [[0.014, 0], [0.026, 0.009], [0.026, 0.16], [0.022, 0.218], [0.013, 0.225]],
    [0, 0.09, 0], palette.wood);
  cylinder(group, 0.022, 0.022, 0.018, [0, 0.316, 0], NEUTRALS.metal, 24);
  cylinder(group, 0.027, 0.025, 0.075, [0, 1.2675, 0], NEUTRALS.dark, 24, { surface: 'ceramic' });
  cylinder(group, 0.026, 0.026, 0.021, [0, 1.309, 0], NEUTRALS.metal, 24);
  ellipsoid(group, [0.09, 0.127, 0.09], [0, 1.365, 0], NEUTRALS.cream, { surface: 'ceramic', roughness: 0.20 });
  lathe(group, [[0.293, 0], [0.287, 0.075], [0.255, 0.22], [0.205, 0.35], [0.17, 0.393],
    [0.164, 0.393], [0.199, 0.348], [0.249, 0.218], [0.281, 0.075], [0.287, 0], [0.293, 0]],
  [0, 1.2, 0], palette.fabric, { surface: 'fabric', doubleSided: true });
  for (const [radius, y] of [[0.293, 1.2], [0.17, 1.593]]) {
    const rim = torus(group, radius, 0.007, [0, y, 0], palette.accent, { surface: 'fabric' });
    rim.rotation.x = Math.PI / 2;
  }
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    rod(group, [0, 1.232, 0], [Math.cos(angle) * 0.287, 1.205, Math.sin(angle) * 0.287],
      0.003, NEUTRALS.metal);
  }
  tube(group, [[-0.029, 1.28, 0], [-0.077, 1.40, 0], [-0.067, 1.535, 0],
    [0, 1.566, 0], [0.067, 1.535, 0], [0.077, 1.40, 0], [0.029, 1.28, 0]], 0.0035, NEUTRALS.metal);
  rod(group, [0, 1.566, 0], [0.16, 1.587, 0], 0.003, NEUTRALS.metal);
  rod(group, [0, 1.566, 0], [-0.16, 1.587, 0], 0.003, NEUTRALS.metal);
  rod(group, [0.022, 1.265, 0.022], [0.068, 1.238, 0.035], 0.009, NEUTRALS.metal);
  rod(group, [0.068, 1.238, 0.035], [0.068, 1.070, 0.035], 0.0018, NEUTRALS.metal);
  ellipsoid(group, [0.013, 0.026, 0.013], [0.068, 1.063, 0.035], palette.wood);
  return group;
}

export function buildSideboard(color: FurnitureColor) {
  const group = modelGroup('sideboard');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.645, 0.645]) {
    for (const z of [-0.148, 0.148]) {
      cylinder(group, 0.028, 0.020, 0.16, [x, 0.08, z], palette.wood, 20);
      cylinder(group, 0.021, 0.020, 0.031, [x, 0.0155, z], NEUTRALS.metal, 20);
    }
  }
  box(group, [1.43, 0.035, 0.413], [0, 0.168, -0.0185], palette.wood, 0.012);
  box(group, [1.38, 0.681, 0.021], [0, 0.5225, -0.2145], palette.wood, 0.005);
  for (const x of [-0.715, 0.715]) {
    box(group, [0.035, 0.679, 0.414], [x, 0.5235, -0.018], palette.wood, 0.008);
  }
  box(group, [1.402, 0.666, 0.014], [0, 0.526, 0.172], NEUTRALS.dark, 0.004);
  for (const x of [-0.479, 0.479]) {
    box(group, [0.459, 0.644, 0.021], [x, 0.526, 0.182], palette.wood, 0.009);
    box(group, [0.376, 0.552, 0.006], [x, 0.526, 0.195], palette.wood, 0.011);
    metalPull(group, x < 0 ? -0.322 : 0.322, 0.58, 0.198, 0.16, true);
  }
  for (const y of [0.361, 0.691]) {
    box(group, [0.470, 0.314, 0.021], [0, y, 0.182], palette.wood, 0.009);
    box(group, [0.409, 0.252, 0.006], [0, y, 0.195], palette.wood, 0.008);
    metalPull(group, 0, y + 0.055, 0.198, 0.145);
  }
  box(group, [1.459, 0.016, 0.423], [0, 0.858, -0.008], NEUTRALS.dark, 0.005);
  box(group, [1.5, 0.035, 0.45], [0, 0.8825, 0], palette.wood, 0.015);
  return group;
}

export function buildSideTable(color: FurnitureColor) {
  const group = modelGroup('side-table');
  const palette = FURNITURE_PALETTES[color];
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    cylinder(group, 0.020, 0.020, 0.025, [x * 0.18, 0.0125, z * 0.18], NEUTRALS.metal, 20);
    rod(group, [x * 0.18, 0.026, z * 0.18], [x * 0.122, 0.54, z * 0.122],
      0.019, palette.wood, 0.027);
    rod(group, [0, 0.201, 0], [x * 0.159, 0.201, z * 0.159], 0.012, palette.wood);
    cylinder(group, 0.032, 0.029, 0.024, [x * 0.125, 0.528, z * 0.125], NEUTRALS.metal, 24);
  }
  cylinder(group, 0.156, 0.15, 0.026, [0, 0.224, 0], palette.wood, 48);
  const shelfLip = torus(group, 0.150, 0.005, [0, 0.237, 0], palette.accent, { surface: 'wood' });
  shelfLip.rotation.x = Math.PI / 2;
  cylinder(group, 0.178, 0.154, 0.027, [0, 0.5295, 0], palette.wood, 48);
  lathe(group, [[0, 0.54], [0.23, 0.54], [0.246, 0.548], [0.25, 0.559],
    [0.248, 0.571], [0.24, 0.58], [0.228, 0.58], [0.22, 0.57], [0, 0.57]], [0, 0, 0], palette.wood);
  cylinder(group, 0.219, 0.219, 0.006, [0, 0.573, 0], palette.fabric, 48, { surface: 'stone' });
  const rim = torus(group, 0.224, 0.002, [0, 0.576, 0], NEUTRALS.metal);
  rim.rotation.x = Math.PI / 2;
  return group;
}
