import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three';
import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cylinder, ellipsoid, lathe, material, modelGroup, piping, rod, torus, tube } from '../primitives';
import type { FurnitureColor } from '../types';

let leafGeometry: BufferGeometry | undefined;

function plantLeaf() {
  if (!leafGeometry) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= 12; row += 1) {
      const t = row / 12;
      const width = Math.sin(t * Math.PI) ** 0.75;
      for (let column = 0; column <= 4; column += 1) {
        const s = column / 2 - 1;
        positions.push(s * width * 0.5, t, (0.13 + s * s * 0.16) * Math.sin(t * Math.PI));
        if (row < 12 && column < 4) {
          const a = row * 5 + column;
          indices.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
        }
      }
    }
    leafGeometry = new BufferGeometry();
    leafGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    leafGeometry.setIndex(indices);
    leafGeometry.computeVertexNormals();
    leafGeometry.userData.shared = true;
  }
  return leafGeometry;
}

export function buildPlant(color: FurnitureColor) {
  const group = modelGroup('plant');
  const palette = FURNITURE_PALETTES[color];
  lathe(group, [[0, 0], [0.14, 0], [0.155, 0.018], [0.19, 0.27], [0.207, 0.32],
    [0.21, 0.345], [0.202, 0.357], [0.184, 0.35], [0.18, 0.315], [0.15, 0.04], [0, 0.04]],
  [0, 0, 0], palette.accent, { surface: 'ceramic', roughness: 0.55 });
  const rim = torus(group, 0.196, 0.01, [0, 0.345, 0], palette.accent, { surface: 'ceramic' });
  rim.rotation.x = Math.PI / 2;
  cylinder(group, 0.179, 0.179, 0.014, [0, 0.316, 0], NEUTRALS.soil);
  tube(group, [[0, 0.32, 0], [0.015, 0.57, 0], [-0.015, 0.87, 0.018], [0.005, 1.14, 0]], 0.009, NEUTRALS.leaf);
  for (let index = 0; index < 9; index += 1) {
    const angle = index * 2.4;
    const y = 0.51 + index * 0.069;
    const x = Math.cos(angle) * 0.12;
    const z = Math.sin(angle) * 0.065;
    rod(group, [0, y - 0.055, 0], [x, y, z], 0.005, NEUTRALS.leaf, 0.003);
    const leaf = new Group();
    const blade = new Mesh(plantLeaf(), material(index % 3 ? NEUTRALS.leaf : NEUTRALS.leafLight,
      { roughness: 0.5, doubleSided: true }));
    const length = index > 6 ? 0.22 : 0.32;
    blade.scale.set(0.17, length, length);
    blade.castShadow = blade.receiveShadow = true;
    leaf.add(blade);
    tube(leaf, [[0, 0.012, 0.003], [0, length * 0.5, length * 0.135], [0, length * 0.94, length * 0.028]],
      0.0018, NEUTRALS.leafLight);
    leaf.position.set(x, y, z);
    leaf.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(Math.cos(angle), 0.48, Math.sin(angle) * 0.38).normalize());
    group.add(leaf);
  }
  return group;
}

export function buildRug(color: FurnitureColor) {
  const group = modelGroup('rug');
  const palette = FURNITURE_PALETTES[color];
  box(group, [2, 0.018, 1.32], [0, 0.009, 0], palette.fabric, 0.008);
  box(group, [1.88, 0.005, 1.2], [0, 0.02, 0], palette.accent, 0.008);
  box(group, [1.79, 0.004, 1.11], [0, 0.024, 0], palette.fabric, 0.008);
  piping(group, 1.94, 1.26, [0, 0.021, 0], NEUTRALS.cream, 0.025);
  for (const x of [-0.49, 0, 0.49]) {
    const diamond = box(group, [0.31, 0.002, 0.31], [x, 0.027, 0], NEUTRALS.cream, 0.004, { surface: 'fabric' });
    diamond.rotation.y = Math.PI / 4;
    const inset = box(group, [0.23, 0.002, 0.23], [x, 0.029, 0], palette.accent, 0.003);
    inset.rotation.y = Math.PI / 4;
  }
  for (const side of [-1, 1]) {
    for (let index = 0; index < 24; index += 1) {
      const x = -0.93 + index * 1.86 / 23;
      rod(group, [x, 0.011, side * 0.653], [x + 0.004, 0.008, side * 0.695], 0.002, NEUTRALS.cream, 0.002, { surface: 'fabric' });
    }
  }
  return group;
}

export function buildAccentChair(color: FurnitureColor) {
  const group = modelGroup('accent-chair');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-1, 1]) {
    rod(group, [x * 0.31, 0.017, 0.29], [x * 0.265, 0.47, 0.23], 0.024, palette.wood, 0.034);
    rod(group, [x * 0.31, 0.017, -0.29], [x * 0.27, 0.68, -0.22], 0.022, palette.wood, 0.03);
    box(group, [0.05, 0.085, 0.57], [x * 0.27, 0.32, 0], palette.wood, 0.018);
    rod(group, [x * 0.32, 0.39, 0.2], [x * 0.32, 0.64, 0.2], 0.018, palette.wood);
    box(group, [0.095, 0.058, 0.64], [x * 0.32, 0.66, -0.025], palette.wood, 0.027);
  }
  box(group, [0.6, 0.07, 0.56], [0, 0.345, 0.015], palette.wood, 0.025);
  box(group, [0.61, 0.15, 0.57], [0, 0.44, 0.025], palette.fabric, 0.072);
  piping(group, 0.613, 0.573, [0, 0.44, 0.025], palette.accent, 0.075);
  const back = new Group();
  box(back, [0.63, 0.45, 0.1], [0, 0, 0], palette.wood, 0.045);
  box(back, [0.58, 0.41, 0.12], [0, 0.012, 0.055], palette.fabric, 0.058);
  const seam = piping(back, 0.54, 0.37, [0, 0.012, 0.107], palette.accent, 0.065);
  seam.rotation.x = Math.PI / 2;
  back.position.set(0, 0.698, -0.245);
  back.rotation.x = -0.14;
  group.add(back);
  const pillow = box(group, [0.35, 0.17, 0.15], [0, 0.58, -0.105], palette.accent, 0.07);
  pillow.rotation.x = -0.13;
  return group;
}

export function buildShoeCabinet(color: FurnitureColor) {
  const group = modelGroup('shoe-cabinet');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.41, 0.41]) {
    for (const z of [-0.12, 0.12]) {
      rod(group, [x, 0.01, z], [x, 0.15, z], 0.02, NEUTRALS.metal);
    }
  }
  box(group, [0.98, 0.92, 0.315], [0, 0.59, -0.009], palette.wood, 0.018);
  box(group, [1, 0.04, 0.35], [0, 1.08, 0], palette.wood, 0.016);
  for (const y of [0.355, 0.8]) {
    box(group, [0.91, 0.42, 0.025], [0, y, 0.16], palette.wood, 0.011);
    box(group, [0.84, 0.35, 0.009], [0, y, 0.175], palette.fabric, 0.009, { surface: 'plain', roughness: 0.5 });
    for (let index = 0; index < 8; index += 1) {
      box(group, [0.57, 0.008, 0.008], [0, y - 0.115 + index * 0.032, 0.183], palette.wood, 0.003);
    }
    rod(group, [-0.12, y + 0.135, 0.192], [0.12, y + 0.135, 0.192], 0.008, NEUTRALS.metal);
  }
  return group;
}

export function buildCoatRack(color: FurnitureColor) {
  const group = modelGroup('coat-rack');
  const palette = FURNITURE_PALETTES[color];
  lathe(group, [[0, 0], [0.25, 0], [0.28, 0.015], [0.275, 0.035], [0.23, 0.055], [0, 0.055]],
    [0, 0, 0], palette.wood);
  cylinder(group, 0.022, 0.038, 1.68, [0, 0.89, 0], palette.wood);
  ellipsoid(group, [0.065, 0.07, 0.065], [0, 1.735, 0], palette.wood);
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3;
    const y = 1.15 + (index % 3) * 0.17;
    const end: [number, number, number] = [Math.cos(angle) * 0.225, y + 0.13, Math.sin(angle) * 0.225];
    tube(group, [[0, y - 0.035, 0], [Math.cos(angle) * 0.12, y + 0.012, Math.sin(angle) * 0.12], end], 0.014, palette.wood);
    ellipsoid(group, [0.039, 0.039, 0.039], end, palette.accent, { surface: 'plain' });
  }
  return group;
}

export function buildOttoman(color: FurnitureColor) {
  const group = modelGroup('ottoman');
  const palette = FURNITURE_PALETTES[color];
  cylinder(group, 0.28, 0.275, 0.065, [0, 0.0325, 0], palette.wood);
  lathe(group, [[0, 0.055], [0.27, 0.055], [0.296, 0.075], [0.31, 0.12], [0.32, 0.29],
    [0.316, 0.35], [0.303, 0.395], [0.27, 0.42], [0.19, 0.43], [0, 0.435]], [0, 0, 0], palette.fabric);
  for (const y of [0.105, 0.385]) {
    const seam = torus(group, y < 0.2 ? 0.307 : 0.306, 0.003, [0, y, 0], palette.accent);
    seam.rotation.x = Math.PI / 2;
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI / 4;
    tube(group, [[Math.cos(angle) * 0.309, 0.12, Math.sin(angle) * 0.309],
      [Math.cos(angle) * 0.321, 0.26, Math.sin(angle) * 0.321],
      [Math.cos(angle) * 0.313, 0.35, Math.sin(angle) * 0.313]], 0.0015, palette.accent);
  }
  ellipsoid(group, [0.04, 0.01, 0.04], [0, 0.434, 0], palette.accent);
  return group;
}
