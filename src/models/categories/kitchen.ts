import { ExtrudeGeometry, Mesh, Shape, type Group } from 'three';
import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cachedGeometry, cylinder, lathe, material, modelGroup, piping, rod, screenMaterial, torus, tube } from '../primitives';
import type { FurnitureColor } from '../types';

function pull(parent: Group, x: number, y: number, z: number, length: number, color: number = NEUTRALS.metal, vertical = false) {
  const ends: [number, number, number][] = [-1, 1].map((sign) => [
    x + (vertical ? 0 : sign * length / 2),
    y + (vertical ? sign * length / 2 : 0),
    z,
  ]);
  for (const [px, py] of ends) rod(parent, [px, py, z - 0.025], [px, py, z], 0.005, color, 0.005, { surface: 'metal' });
  rod(parent, ends[0], ends[1], 0.008, color, 0.008, { surface: 'metal' });
}

function curvedBack(parent: Group, width: number, height: number, bow: number, thickness: number, position: [number, number, number], color: number) {
  const geometry = cachedGeometry(`curved-back-${width}-${height}-${bow}-${thickness}`, () => {
    const shape = new Shape();
    shape.moveTo(-width / 2, 0);
    shape.quadraticCurveTo(0, bow * 2, width / 2, 0);
    shape.lineTo(width / 2, -thickness);
    shape.quadraticCurveTo(0, bow * 2 - thickness, -width / 2, -thickness);
    shape.closePath();
    const back = new ExtrudeGeometry(shape, {
      depth: height, steps: 1, curveSegments: 32,
      bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4,
    });
    back.rotateX(-Math.PI / 2);
    return back;
  });
  const mesh = new Mesh(geometry, material(color, { surface: 'fabric' }));
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildDiningTable(color: FurnitureColor) {
  const group = modelGroup('dining-table');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.4, 0.055, 0.8], [0, 0.7225, 0], palette.wood, 0.023);
  box(group, [1.354, 0.019, 0.754], [0, 0.6855, 0], palette.wood, 0.009);
  for (const z of [-0.287, 0.287]) {
    box(group, [1.12, 0.102, 0.035], [0, 0.631, z], palette.wood, 0.008);
    box(group, [1.04, 0.009, 0.006], [0, 0.586, z + Math.sign(z) * 0.019], palette.wood, 0.002);
  }
  for (const x of [-0.567, 0.567]) {
    box(group, [0.035, 0.102, 0.56], [x, 0.631, 0], palette.wood, 0.008);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylinder(group, 0.023, 0.023, 0.012, [sx * 0.613, 0.006, sz * 0.329], NEUTRALS.dark, 20);
      rod(group, [sx * 0.613, 0.018, sz * 0.329], [sx * 0.554, 0.676, sz * 0.278], 0.022, palette.wood, 0.038);
      rod(group, [sx * 0.612, 0.023, sz * 0.328], [sx * 0.608, 0.065, sz * 0.325], 0.023, palette.accent, 0.024, { surface: 'metal', roughness: 0.36 });
      const block = box(group, [0.095, 0.06, 0.053], [sx * 0.518, 0.653, sz * 0.24], palette.wood, 0.009);
      block.rotation.y = sx * sz * Math.PI / 4;
    }
  }
  return group;
}

export function buildDiningChair(color: FurnitureColor) {
  const group = modelGroup('dining-chair');
  const palette = FURNITURE_PALETTES[color];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylinder(group, 0.016, 0.016, 0.012, [sx * 0.194, 0.006, sz * 0.207], NEUTRALS.dark, 20);
      rod(group, [sx * 0.194, 0.017, sz * 0.207], [sx * 0.163, 0.411, sz * 0.164], 0.015, palette.wood, 0.023);
      rod(group, [sx * 0.193, 0.023, sz * 0.206], [sx * 0.19, 0.061, sz * 0.202], 0.016, palette.accent, 0.017, { surface: 'metal' });
    }
  }
  for (const x of [-0.165, 0.165]) box(group, [0.026, 0.049, 0.335], [x, 0.379, 0], palette.wood, 0.007);
  for (const z of [-0.164, 0.164]) box(group, [0.32, 0.049, 0.026], [0, 0.379, z], palette.wood, 0.007);
  box(group, [0.45, 0.038, 0.43], [0, 0.406, 0.02], palette.wood, 0.018);
  box(group, [0.426, 0.07, 0.422], [0, 0.455, 0.02], palette.fabric, 0.034);
  piping(group, 0.409, 0.402, [0, 0.457, 0.02], palette.accent, 0.08);
  for (const x of [-0.173, 0.173]) {
    rod(group, [x, 0.399, -0.16], [x, 0.854, -0.16], 0.019, palette.wood, 0.015);
    cylinder(group, 0.008, 0.008, 0.008, [x, 0.397, -0.16], NEUTRALS.metal, 16);
  }
  curvedBack(group, 0.406, 0.231, 0.088, 0.032, [0, 0.667, -0.135], palette.fabric);
  tube(group, [[-0.19, 0.883, -0.111], [-0.1, 0.883, -0.167], [0, 0.883, -0.188], [0.1, 0.883, -0.167], [0.19, 0.883, -0.111]], 0.0025, palette.accent, false, { surface: 'fabric' });
  return group;
}

export function buildFridge(color: FurnitureColor) {
  const group = modelGroup('fridge');
  const palette = FURNITURE_PALETTES[color];
  const enamel = { surface: 'metal' as const, roughness: 0.34, metalness: 0.18 };
  box(group, [0.7, 1.73, 0.68], [0, 0.935, -0.05], NEUTRALS.cream, 0.036, enamel);
  for (const x of [-0.267, 0.267]) {
    for (const z of [-0.285, 0.255]) cylinder(group, 0.025, 0.028, 0.075, [x, 0.0375, z], NEUTRALS.dark, 20);
  }
  box(group, [0.664, 1.688, 0.018], [0, 0.934, 0.297], NEUTRALS.dark, 0.018);
  box(group, [0.666, 1.1, 0.052], [0, 1.22, 0.322], palette.fabric, 0.025, enamel);
  box(group, [0.666, 0.506, 0.052], [0, 0.393, 0.322], palette.fabric, 0.025, enamel);
  box(group, [0.618, 0.01, 0.007], [0, 0.657, 0.31], NEUTRALS.metal, 0.002);
  pull(group, 0.25, 1.16, 0.382, 0.416, NEUTRALS.metal, true);
  pull(group, 0.25, 0.397, 0.382, 0.219, NEUTRALS.metal, true);
  box(group, [0.152, 0.203, 0.009], [-0.136, 1.429, 0.349], NEUTRALS.metal, 0.013);
  const display = box(group, [0.137, 0.186, 0.005], [-0.136, 1.429, 0.355], NEUTRALS.dark, 0.008);
  display.material = screenMaterial();
  for (const x of [-0.163, -0.122]) {
    box(group, [0.024, 0.004, 0.002], [x, 1.478, 0.359], NEUTRALS.cream, 0.001);
    box(group, [0.004, 0.032, 0.002], [x + 0.01, 1.464, 0.359], NEUTRALS.cream, 0.001);
    box(group, [0.024, 0.004, 0.002], [x, 1.448, 0.359], NEUTRALS.cream, 0.001);
  }
  for (const x of [-0.165, -0.135, -0.105]) box(group, [0.016, 0.006, 0.002], [x, 1.379, 0.359], palette.accent, 0.002, enamel);
  box(group, [0.071, 0.012, 0.004], [-0.236, 1.689, 0.352], NEUTRALS.metal, 0.004);
  box(group, [0.64, 0.075, 0.036], [0, 0.098, 0.306], NEUTRALS.dark, 0.01);
  for (const y of [0.078, 0.092, 0.106, 0.12]) box(group, [0.584, 0.005, 0.004], [0, y, 0.326], NEUTRALS.metal, 0.001);
  for (const x of [-0.266, 0.266]) box(group, [0.072, 0.022, 0.053], [x, 1.777, 0.286], NEUTRALS.metal, 0.007);
  return group;
}

export function buildKitchenCabinet(color: FurnitureColor) {
  const group = modelGroup('kitchen-cabinet');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.62, 0.13, 0.5], [0, 0.065, -0.022], NEUTRALS.dark, 0.008);
  box(group, [1.66, 0.026, 0.514], [0, 0.126, -0.022], palette.wood, 0.006);
  box(group, [1.78, 0.714, 0.58], [0, 0.49, -0.016], palette.wood, 0.012);
  box(group, [1.8, 0.012, 0.648], [0, 0.846, 0], NEUTRALS.cream, 0.005, { surface: 'stone' });
  box(group, [1.84, 0.058, 0.68], [0, 0.881, 0], NEUTRALS.cream, 0.012, { surface: 'stone', roughness: 0.3 });
  for (const x of [-0.585, 0, 0.585]) {
    box(group, [0.568, 0.674, 0.012], [x, 0.498, 0.279], NEUTRALS.dark, 0.005);
    box(group, [0.55, 0.492, 0.032], [x, 0.422, 0.296], palette.wood, 0.008);
    box(group, [0.454, 0.393, 0.009], [x, 0.422, 0.313], palette.wood, 0.006);
    box(group, [0.55, 0.16, 0.032], [x, 0.756, 0.296], palette.wood, 0.008);
    box(group, [0.466, 0.094, 0.008], [x, 0.756, 0.314], palette.wood, 0.005);
    pull(group, x, 0.605, 0.332, 0.15);
    pull(group, x, 0.757, 0.332, 0.19);
  }
  for (const x of [-0.884, 0.884]) box(group, [0.018, 0.672, 0.526], [x, 0.488, -0.013], palette.wood, 0.004);
  return group;
}

export function buildStove(color: FurnitureColor) {
  const group = modelGroup('stove');
  const palette = FURNITURE_PALETTES[color];
  const enamel = { surface: 'metal' as const, roughness: 0.32, metalness: 0.2 };
  for (const x of [-0.235, 0.235]) {
    for (const z of [-0.267, 0.227]) cylinder(group, 0.023, 0.026, 0.08, [x, 0.04, z], NEUTRALS.dark, 20);
  }
  box(group, [0.6, 0.786, 0.594], [0, 0.456, -0.038], NEUTRALS.cream, 0.018, enamel);
  box(group, [0.594, 0.025, 0.601], [0, 0.8675, -0.0275], NEUTRALS.metal, 0.01);
  box(group, [0.568, 0.008, 0.557], [0, 0.883, -0.0275], NEUTRALS.dark, 0.015, { surface: 'metal', roughness: 0.3 });
  for (const x of [-0.143, 0.143]) {
    for (const z of [-0.163, 0.121]) {
      const radius = z < 0 ? 0.067 : 0.057;
      cylinder(group, radius, radius + 0.004, 0.016, [x, 0.896, z], NEUTRALS.metal, 32);
      cylinder(group, radius * 0.82, radius * 0.88, 0.012, [x, 0.91, z], NEUTRALS.dark, 32, { surface: 'metal', roughness: 0.7 });
      const ring = torus(group, radius + 0.024, 0.007, [x, 0.928, z], NEUTRALS.dark, { surface: 'metal', roughness: 0.7 });
      ring.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) cylinder(group, 0.009, 0.01, 0.042, [x + side * (radius + 0.024), 0.908, z], NEUTRALS.dark, 16, { surface: 'metal', roughness: 0.7 });
      rod(group, [x - 0.101, 0.941, z], [x + 0.101, 0.941, z], 0.009, NEUTRALS.dark, 0.009, { surface: 'metal', roughness: 0.7 });
      rod(group, [x, 0.941, z - 0.101], [x, 0.941, z + 0.101], 0.009, NEUTRALS.dark, 0.009, { surface: 'metal', roughness: 0.7 });
    }
  }
  box(group, [0.558, 0.092, 0.034], [0, 0.791, 0.272], palette.fabric, 0.01, enamel);
  for (const x of [-0.205, -0.068, 0.068, 0.205]) {
    const bezel = cylinder(group, 0.03, 0.03, 0.008, [x, 0.788, 0.293], NEUTRALS.dark, 24);
    bezel.rotation.x = Math.PI / 2;
    const knob = cylinder(group, 0.024, 0.027, 0.028, [x, 0.788, 0.307], NEUTRALS.metal, 24);
    knob.rotation.x = Math.PI / 2;
    box(group, [0.003, 0.012, 0.002], [x, 0.799, 0.322], NEUTRALS.cream, 0.001);
  }
  box(group, [0.534, 0.514, 0.038], [0, 0.447, 0.272], NEUTRALS.dark, 0.021, { roughness: 0.27 });
  box(group, [0.451, 0.359, 0.008], [0, 0.447, 0.294], 0x131b1a, 0.009);
  for (const y of [0.331, 0.41, 0.489]) rod(group, [-0.192, y, 0.301], [0.192, y, 0.301], 0.003, NEUTRALS.metal);
  box(group, [0.453, 0.36, 0.009], [0, 0.449, 0.308], NEUTRALS.glass, 0.014, { surface: 'plain', roughness: 0.1, metalness: 0.16, transparent: true, opacity: 0.32 });
  for (const x of [-0.246, 0.246]) box(group, [0.014, 0.458, 0.008], [x, 0.441, 0.297], NEUTRALS.metal, 0.004);
  for (const y of [0.221, 0.655]) box(group, [0.492, 0.014, 0.008], [0, y, 0.297], NEUTRALS.metal, 0.004);
  pull(group, 0, 0.687, 0.327, 0.418);
  box(group, [0.541, 0.071, 0.028], [0, 0.126, 0.276], palette.fabric, 0.01, enamel);
  box(group, [0.195, 0.009, 0.003], [0, 0.146, 0.292], NEUTRALS.dark, 0.003);
  for (const x of [-0.18, -0.06, 0.06, 0.18]) box(group, [0.087, 0.005, 0.004], [x, 0.184, 0.293], NEUTRALS.dark, 0.002);
  return group;
}

export function buildRoundDiningTable(color: FurnitureColor) {
  const group = modelGroup('round-dining-table');
  const palette = FURNITURE_PALETTES[color];
  lathe(group, [[0, 0.704], [0.49, 0.704], [0.535, 0.712], [0.548, 0.722], [0.55, 0.735], [0.548, 0.748], [0.537, 0.758], [0.52, 0.76], [0, 0.76]], [0, 0, 0], palette.wood);
  lathe(group, [[0, 0], [0.24, 0], [0.303, 0.006], [0.326, 0.021], [0.329, 0.034], [0.319, 0.049], [0.291, 0.066], [0.241, 0.112], [0.207, 0.183], [0.177, 0.287], [0.167, 0.4], [0.184, 0.52], [0.236, 0.626], [0.282, 0.676], [0.286, 0.704], [0, 0.704]], [0, 0, 0], palette.wood);
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI / 8;
    const points: [number, number, number][] = [[0.268, 0.09], [0.222, 0.15], [0.189, 0.25], [0.172, 0.35], [0.177, 0.45], [0.2, 0.55], [0.252, 0.645]].map(([radius, y]) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
    tube(group, points, 0.0025, palette.wood, false, { surface: 'wood' });
  }
  const trim = torus(group, 0.322, 0.004, [0, 0.023, 0], palette.accent, { surface: 'metal' });
  trim.rotation.x = Math.PI / 2;
  cylinder(group, 0.29, 0.275, 0.016, [0, 0.696, 0], palette.wood, 48);
  return group;
}

export function buildBarStool(color: FurnitureColor) {
  const group = modelGroup('bar-stool');
  const palette = FURNITURE_PALETTES[color];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylinder(group, 0.017, 0.017, 0.012, [sx * 0.194, 0.006, sz * 0.194], NEUTRALS.dark, 20);
      rod(group, [sx * 0.194, 0.017, sz * 0.194], [sx * 0.126, 0.628, sz * 0.126], 0.014, palette.wood, 0.021);
      rod(group, [sx * 0.193, 0.024, sz * 0.193], [sx * 0.188, 0.069, sz * 0.188], 0.015, palette.accent, 0.016, { surface: 'metal' });
      rod(group, [sx * 0.169, 0.245, sz * 0.169], [sx * 0.134, 0.245, sz * 0.134], 0.009, NEUTRALS.metal);
    }
  }
  const footrest = torus(group, 0.192, 0.012, [0, 0.245, 0], NEUTRALS.metal);
  footrest.rotation.x = Math.PI / 2;
  lathe(group, [[0, 0.61], [0.195, 0.61], [0.225, 0.618], [0.229, 0.635], [0.22, 0.646], [0, 0.646]], [0, 0, 0], palette.wood);
  lathe(group, [[0, 0.638], [0.21, 0.638], [0.234, 0.646], [0.24, 0.66], [0.24, 0.676], [0.232, 0.691], [0.212, 0.701], [0.15, 0.704], [0, 0.704]], [0, 0, 0], palette.fabric);
  const seam = torus(group, 0.237, 0.0025, [0, 0.664, 0], palette.accent, { surface: 'fabric' });
  seam.rotation.x = Math.PI / 2;
  for (const x of [-0.15, 0.15]) rod(group, [x, 0.625, -0.15], [x, 0.894, -0.174], 0.013, palette.wood);
  curvedBack(group, 0.36, 0.16, 0.051, 0.029, [0, 0.778, -0.171], palette.fabric);
  tube(group, [[-0.166, 0.928, -0.159], [-0.09, 0.928, -0.192], [0, 0.928, -0.202], [0.09, 0.928, -0.192], [0.166, 0.928, -0.159]], 0.0025, palette.accent, false, { surface: 'fabric' });
  return group;
}

export function buildKitchenIsland(color: FurnitureColor) {
  const group = modelGroup('kitchen-island');
  const palette = FURNITURE_PALETTES[color];
  box(group, [1.12, 0.13, 0.54], [-0.12, 0.065, -0.075], NEUTRALS.dark, 0.012);
  box(group, [1.18, 0.035, 0.61], [-0.12, 0.1475, -0.08], palette.wood, 0.008);
  box(group, [1.18, 0.7, 0.028], [-0.12, 0.515, -0.371], palette.wood, 0.006);
  for (const x of [-0.692, 0.452]) box(group, [0.036, 0.7, 0.584], [x, 0.515, -0.067], palette.wood, 0.006);
  box(group, [0.027, 0.7, 0.574], [0.163, 0.515, -0.062], palette.wood, 0.005);
  box(group, [0.84, 0.681, 0.022], [-0.272, 0.506, 0.215], NEUTRALS.dark, 0.004);
  for (const x of [-0.479, -0.057]) {
    box(group, [0.404, 0.444, 0.03], [x, 0.397, 0.236], palette.wood, 0.007);
    box(group, [0.32, 0.36, 0.008], [x, 0.397, 0.254], palette.wood, 0.005);
    box(group, [0.404, 0.213, 0.03], [x, 0.739, 0.236], palette.wood, 0.007);
    box(group, [0.324, 0.135, 0.008], [x, 0.739, 0.254], palette.wood, 0.005);
    pull(group, x, 0.568, 0.279, 0.152);
    pull(group, x, 0.74, 0.279, 0.188);
  }
  box(group, [0.275, 0.025, 0.566], [0.307, 0.473, -0.067], palette.wood, 0.004);
  for (const y of [0.192, 0.218]) box(group, [0.205, 0.025, 0.318], [0.307, y, 0.009], y < 0.2 ? palette.fabric : palette.accent, 0.011, { surface: 'fabric' });
  piping(group, 0.188, 0.294, [0.307, 0.22, 0.009], palette.fabric, 0.026);
  for (const y of [0.486, 0.511]) {
    lathe(group, [[0, 0], [0.05, 0], [0.069, 0.008], [0.091, 0.039], [0.095, 0.05], [0.09, 0.053], [0.084, 0.041], [0.063, 0.016], [0, 0.014]], [0.307, y, 0.048], NEUTRALS.cream, { surface: 'ceramic' });
  }
  for (const x of [-0.53, 0.354]) rod(group, [x, 0.732, 0.202], [x, 0.865, 0.344], 0.012, NEUTRALS.metal);
  box(group, [1.46, 0.018, 0.81], [0, 0.866, 0], NEUTRALS.cream, 0.008, { surface: 'stone' });
  box(group, [1.5, 0.065, 0.85], [0, 0.9075, 0], NEUTRALS.cream, 0.015, { surface: 'stone', roughness: 0.29 });
  return group;
}
