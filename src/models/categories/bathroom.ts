import { ExtrudeGeometry, Mesh, Path, Shape } from 'three';
import { FURNITURE_PALETTES, NEUTRALS } from '../palette';
import { box, cachedGeometry, cylinder, ellipsoid, glass, lathe, material, modelGroup, rod, screenMaterial, torus, tube } from '../primitives';
import type { FurnitureColor } from '../types';

export function buildToilet(color: FurnitureColor) {
  const group = modelGroup('toilet');
  const palette = FURNITURE_PALETTES[color];
  const ceramic = { surface: 'ceramic' as const, roughness: 0.21 };
  const pedestal = lathe(group, [[0, 0], [0.87, 0], [0.98, 0.009], [1, 0.024], [0.96, 0.047], [0.83, 0.103], [0.76, 0.184], [0.81, 0.247], [0.92, 0.287], [0, 0.287]], [0, 0, 0.025], NEUTRALS.white, ceramic);
  pedestal.scale.set(0.158, 1, 0.204);
  const bowl = lathe(group, [[0, 0.184], [0.4, 0.184], [0.57, 0.205], [0.69, 0.243], [0.81, 0.292], [0.9, 0.345], [0.971, 0.389], [1, 0.416], [0.995, 0.432], [0.966, 0.44], [0.931, 0.438], [0.906, 0.427], [0.892, 0.411], [0.85, 0.377], [0.77, 0.339], [0.64, 0.297], [0.47, 0.27], [0.3, 0.259], [0, 0.257]], [0, 0, 0.103], NEUTRALS.white, ceramic);
  bowl.name = 'toilet-hollow-bowl';
  bowl.scale.set(0.23, 1, 0.277);
  const seat = lathe(group, [[0.78, 0.442], [0.94, 0.442], [1, 0.45], [1, 0.459], [0.971, 0.471], [0.804, 0.471], [0.762, 0.461], [0.762, 0.452], [0.78, 0.442]], [0, 0, 0.103], palette.fabric, ceramic);
  seat.name = 'toilet-contoured-seat';
  seat.scale.set(0.224, 1, 0.274);
  const well = cylinder(group, 0.052, 0.048, 0.006, [0, 0.26, 0.103], NEUTRALS.dark, 32);
  well.scale.z = 1.2;
  const water = cylinder(group, 0.06, 0.059, 0.002, [0, 0.264, 0.103], NEUTRALS.water, 40, { surface: 'plain', roughness: 0.12, transparent: true, opacity: 0.65 });
  water.scale.z = 1.23;
  box(group, [0.358, 0.158, 0.162], [0, 0.354, -0.253], NEUTRALS.white, 0.052, ceramic);
  box(group, [0.406, 0.407, 0.196], [0, 0.6205, -0.282], NEUTRALS.white, 0.044, ceramic);
  box(group, [0.398, 0.006, 0.187], [0, 0.825, -0.282], NEUTRALS.dark, 0.021);
  box(group, [0.416, 0.025, 0.194], [0, 0.8325, -0.282], palette.fabric, 0.012, ceramic);
  const flush = cylinder(group, 0.031, 0.031, 0.004, [0.087, 0.847, -0.279], NEUTRALS.metal, 32);
  flush.scale.z = 0.76;
  for (const x of [0.074, 0.101]) box(group, [0.022, 0.002, 0.029], [x, 0.849, -0.279], palette.accent, 0.004, { surface: 'metal' });
  // Upright lid exposes the hollow bowl and its thin, shaped seat.
  ellipsoid(group, [0.405, 0.304, 0.036], [0, 0.626, -0.156], NEUTRALS.white, ceramic);
  ellipsoid(group, [0.354, 0.25, 0.012], [0, 0.626, -0.135], palette.fabric, ceramic);
  for (const x of [-0.104, 0.104]) {
    box(group, [0.046, 0.012, 0.042], [x, 0.442, -0.136], NEUTRALS.metal, 0.006);
    rod(group, [x - 0.022, 0.466, -0.14], [x + 0.022, 0.466, -0.14], 0.014, NEUTRALS.metal);
    box(group, [0.036, 0.023, 0.031], [x, 0.449, -0.131], NEUTRALS.white, 0.006, ceramic);
    const fixing = cylinder(group, 0.012, 0.014, 0.006, [x * 1.23, 0.041, 0.015], NEUTRALS.metal, 20);
    fixing.rotation.z = Math.sign(x) * Math.PI / 4;
  }
  tube(group, [[-0.115, 0.435, -0.301], [-0.145, 0.299, -0.324], [-0.157, 0.177, -0.3], [-0.157, 0.139, -0.246]], 0.009, NEUTRALS.metal);
  cylinder(group, 0.022, 0.022, 0.018, [-0.157, 0.134, -0.244], NEUTRALS.metal, 24);
  return group;
}

export function buildVanity(color: FurnitureColor) {
  const group = modelGroup('vanity');
  const palette = FURNITURE_PALETTES[color];
  for (const x of [-0.319, 0.319]) {
    for (const z of [-0.19, 0.183]) {
      cylinder(group, 0.019, 0.02, 0.018, [x, 0.009, z], NEUTRALS.dark, 20);
      cylinder(group, 0.023, 0.017, 0.1, [x, 0.066, z], NEUTRALS.metal, 24);
    }
  }
  box(group, [0.704, 0.027, 0.416], [0, 0.11, -0.015], NEUTRALS.dark, 0.008);
  box(group, [0.794, 0.618, 0.482], [0, 0.426, -0.026], palette.wood, 0.016);
  box(group, [0.749, 0.571, 0.015], [0, 0.424, 0.22], NEUTRALS.dark, 0.006);
  for (const x of [-0.19, 0.19]) {
    box(group, [0.367, 0.558, 0.025], [x, 0.424, 0.235], palette.wood, 0.009);
    box(group, [0.289, 0.467, 0.009], [x, 0.424, 0.251], palette.wood, 0.007);
    const handleX = x + (x < 0 ? 0.124 : -0.124);
    for (const y of [0.455, 0.599]) rod(group, [handleX, y, 0.249], [handleX, y, 0.272], 0.004, NEUTRALS.metal);
    rod(group, [handleX, 0.455, 0.272], [handleX, 0.599, 0.272], 0.007, NEUTRALS.metal);
  }
  box(group, [0.84, 0.05, 0.56], [0, 0.76, 0], NEUTRALS.cream, 0.012, { surface: 'stone', roughness: 0.3 });
  const basin = lathe(group, [[0, 0.785], [0.39, 0.785], [0.5, 0.79], [0.61, 0.805], [0.74, 0.832], [0.85, 0.866], [0.947, 0.91], [0.988, 0.938], [1, 0.949], [0.988, 0.955], [0.959, 0.957], [0.936, 0.95], [0.921, 0.939], [0.886, 0.916], [0.806, 0.88], [0.704, 0.847], [0.574, 0.823], [0.407, 0.81], [0.18, 0.807], [0, 0.807]], [0, 0, 0.035], NEUTRALS.white, { surface: 'ceramic', roughness: 0.18 });
  basin.name = 'vanity-hollow-basin';
  basin.scale.set(0.303, 1, 0.207);
  cylinder(group, 0.024, 0.024, 0.003, [0, 0.809, 0.035], NEUTRALS.metal, 32);
  cylinder(group, 0.016, 0.016, 0.002, [0, 0.811, 0.035], NEUTRALS.dark, 24);
  cylinder(group, 0.013, 0.013, 0.003, [0, 0.813, 0.035], NEUTRALS.metal, 24);
  box(group, [0.036, 0.009, 0.004], [0, 0.925, -0.15], NEUTRALS.dark, 0.004);
  cylinder(group, 0.027, 0.029, 0.012, [0, 0.791, -0.223], NEUTRALS.metal, 32);
  tube(group, [[0, 0.799, -0.223], [0, 0.956, -0.223], [0, 1.022, -0.213], [0, 1.034, -0.181], [0, 1.034, -0.119], [0, 1.014, -0.091]], 0.011, NEUTRALS.metal);
  cylinder(group, 0.012, 0.013, 0.013, [0, 1.008, -0.091], NEUTRALS.metal, 24);
  cylinder(group, 0.009, 0.009, 0.002, [0, 1.001, -0.091], NEUTRALS.dark, 20);
  rod(group, [0.014, 1.011, -0.223], [0.059, 1.011, -0.223], 0.006, NEUTRALS.metal);
  box(group, [0.018, 0.009, 0.052], [0.052, 1.012, -0.211], palette.accent, 0.004, { surface: 'metal' });
  cylinder(group, 0.031, 0.033, 0.091, [-0.353, 0.8305, -0.155], palette.fabric, 32, { surface: 'ceramic' });
  cylinder(group, 0.016, 0.018, 0.013, [-0.353, 0.8825, -0.155], NEUTRALS.metal, 24);
  cylinder(group, 0.006, 0.006, 0.026, [-0.353, 0.901, -0.155], NEUTRALS.metal, 20);
  box(group, [0.049, 0.009, 0.013], [-0.338, 0.915, -0.155], NEUTRALS.metal, 0.004);
  return group;
}

export function buildBathtub(color: FurnitureColor) {
  const group = modelGroup('bathtub');
  const palette = FURNITURE_PALETTES[color];
  const plinth = lathe(group, [[0, 0], [0.61, 0], [0.65, 0.008], [0.69, 0.024], [0.7, 0.041], [0, 0.041]], [0, 0, 0], palette.fabric, { surface: 'ceramic' });
  plinth.scale.set(0.85, 1, 0.39);
  const shell = lathe(group, [[0, 0.027], [0.6, 0.027], [0.68, 0.04], [0.74, 0.065], [0.795, 0.111], [0.846, 0.173], [0.89, 0.25], [0.93, 0.346], [0.961, 0.449], [0.984, 0.528], [1, 0.579], [0.998, 0.598], [0.987, 0.611], [0.968, 0.616], [0.948, 0.613], [0.93, 0.598], [0.918, 0.571], [0.892, 0.478], [0.85, 0.364], [0.798, 0.264], [0.731, 0.205], [0.65, 0.173], [0.54, 0.155], [0.38, 0.145], [0, 0.145]], [0, 0, 0], NEUTRALS.white, { surface: 'ceramic', roughness: 0.2 });
  shell.name = 'bathtub-continuous-hollow-shell';
  shell.scale.set(0.85, 1, 0.39);
  cylinder(group, 0.026, 0.026, 0.004, [-0.38, 0.153, 0], NEUTRALS.metal, 32);
  cylinder(group, 0.019, 0.019, 0.003, [-0.38, 0.156, 0], NEUTRALS.dark, 28);
  cylinder(group, 0.016, 0.016, 0.004, [-0.38, 0.159, 0], NEUTRALS.metal, 28);
  for (const x of [-0.391, -0.369]) box(group, [0.002, 0.001, 0.005], [x, 0.1615, 0], NEUTRALS.dark, 0.0005);
  const overflow = cylinder(group, 0.023, 0.023, 0.009, [-0.757, 0.494, 0], NEUTRALS.metal, 32);
  overflow.rotation.z = Math.PI / 2;
  const overflowSlot = box(group, [0.003, 0.006, 0.026], [-0.75, 0.487, 0], NEUTRALS.dark, 0.002);
  overflowSlot.rotation.z = -0.15;
  cylinder(group, 0.029, 0.031, 0.016, [-0.81, 0.617, 0], NEUTRALS.metal, 32);
  tube(group, [[-0.81, 0.619, 0], [-0.81, 0.725, 0], [-0.796, 0.773, 0], [-0.753, 0.782, 0], [-0.635, 0.781, 0], [-0.599, 0.761, 0]], 0.014, NEUTRALS.metal);
  cylinder(group, 0.015, 0.016, 0.016, [-0.599, 0.754, 0], NEUTRALS.metal, 24);
  cylinder(group, 0.011, 0.011, 0.002, [-0.599, 0.745, 0], NEUTRALS.dark, 20);
  for (const z of [-0.1, 0.1]) {
    cylinder(group, 0.021, 0.023, 0.014, [-0.777, 0.616, z], NEUTRALS.metal, 24);
    cylinder(group, 0.012, 0.014, 0.037, [-0.777, 0.64, z], NEUTRALS.metal, 24);
    box(group, [0.049, 0.013, 0.019], [-0.763, 0.66, z], palette.accent, 0.006, { surface: 'metal' });
  }
  const pillow = ellipsoid(group, [0.108, 0.053, 0.22], [0.777, 0.605, 0], palette.fabric, { surface: 'fabric' });
  pillow.rotation.z = -0.16;
  for (const z of [-0.059, 0.059]) ellipsoid(group, [0.019, 0.009, 0.015], [0.778, 0.631, z], palette.accent, { surface: 'fabric' });
  return group;
}

export function buildShower(color: FurnitureColor) {
  const group = modelGroup('shower');
  const palette = FURNITURE_PALETTES[color];
  box(group, [0.9, 0.082, 0.9], [0, 0.041, 0], NEUTRALS.white, 0.031, { surface: 'ceramic' });
  box(group, [0.798, 0.01, 0.798], [0, 0.084, 0], NEUTRALS.cream, 0.025, { surface: 'stone', roughness: 0.6 });
  for (const z of [-0.421, 0.421]) box(group, [0.844, 0.04, 0.043], [0, 0.095, z], NEUTRALS.white, 0.012);
  for (const x of [-0.421, 0.421]) box(group, [0.043, 0.04, 0.844], [x, 0.095, 0], NEUTRALS.white, 0.012);
  for (const x of [-0.433, 0.433]) glass(group, [0.012, 1.878, 0.842], [x, 1.055, 0]);
  glass(group, [0.842, 1.878, 0.012], [0, 1.055, -0.433]);
  glass(group, [0.271, 1.878, 0.012], [-0.2875, 1.055, 0.429]);
  glass(group, [0.556, 1.848, 0.012], [0.136, 1.064, 0.43]);
  for (const x of [-0.437, 0.437]) {
    for (const z of [-0.437, 0.437]) box(group, [0.024, 1.912, 0.024], [x, 1.05, z], NEUTRALS.metal, 0.005);
  }
  for (const y of [0.127, 2.007]) {
    for (const z of [-0.437, 0.437]) box(group, [0.9, 0.026, 0.025], [0, y, z], NEUTRALS.metal, 0.006);
    for (const x of [-0.437, 0.437]) box(group, [0.025, 0.026, 0.85], [x, y, 0], NEUTRALS.metal, 0.006);
  }
  box(group, [0.015, 1.869, 0.018], [-0.148, 1.0595, 0.429], NEUTRALS.metal, 0.004);
  for (const y of [0.511, 1.583]) {
    box(group, [0.038, 0.069, 0.017], [-0.146, y, 0.439], NEUTRALS.metal, 0.005);
    cylinder(group, 0.009, 0.009, 0.078, [-0.146, y, 0.439], NEUTRALS.metal, 20);
  }
  for (const y of [0.939, 1.165]) rod(group, [0.346, y, 0.425], [0.346, y, 0.443], 0.005, NEUTRALS.metal);
  rod(group, [0.346, 0.939, 0.443], [0.346, 1.165, 0.443], 0.007, NEUTRALS.metal);
  box(group, [0.548, 0.012, 0.016], [0.136, 0.126, 0.429], palette.accent, 0.004, { surface: 'plain', roughness: 0.45 });
  box(group, [0.36, 0.006, 0.058], [0, 0.093, 0.232], NEUTRALS.metal, 0.009);
  for (const x of [-0.128, -0.064, 0, 0.064, 0.128]) box(group, [0.035, 0.002, 0.035], [x, 0.097, 0.232], NEUTRALS.dark, 0.005);

  for (const y of [1.086, 1.706]) {
    const fixing = cylinder(group, 0.024, 0.024, 0.026, [0.175, y, -0.41], NEUTRALS.metal, 24);
    fixing.rotation.x = Math.PI / 2;
  }
  tube(group, [[0.175, 0.995, -0.381], [0.175, 1.725, -0.381], [0.175, 1.852, -0.371], [0.175, 1.877, -0.325], [0.175, 1.871, -0.213], [0.175, 1.845, -0.186]], 0.012, NEUTRALS.metal);
  cylinder(group, 0.025, 0.027, 0.028, [0.175, 1.841, -0.186], NEUTRALS.metal, 24);
  cylinder(group, 0.108, 0.119, 0.019, [0.175, 1.8175, -0.186], NEUTRALS.metal, 48);
  cylinder(group, 0.109, 0.109, 0.003, [0.175, 1.8065, -0.186], NEUTRALS.dark, 40);
  for (let index = 0; index < 7; index += 1) {
    const angle = index * Math.PI * 2 / 7;
    cylinder(group, 0.004, 0.004, 0.003, [0.175 + Math.cos(angle) * 0.071, 1.804, -0.186 + Math.sin(angle) * 0.071], NEUTRALS.cream, 12);
  }
  rod(group, [0.028, 0.995, -0.375], [0.268, 0.995, -0.375], 0.025, NEUTRALS.metal);
  for (const x of [0.028, 0.268]) {
    const knob = cylinder(group, 0.027, 0.027, 0.022, [x, 0.995, -0.345], palette.accent, 24, { surface: 'metal' });
    knob.rotation.x = Math.PI / 2;
    box(group, [0.003, 0.012, 0.002], [x, 1.006, -0.333], NEUTRALS.white, 0.001);
  }
  rod(group, [-0.179, 1.077, -0.387], [-0.179, 1.549, -0.387], 0.01, NEUTRALS.metal);
  for (const y of [1.083, 1.543]) rod(group, [-0.179, y, -0.425], [-0.179, y, -0.383], 0.018, NEUTRALS.metal);
  rod(group, [-0.179, 1.273, -0.352], [-0.179, 1.397, -0.343], 0.015, NEUTRALS.metal);
  const handset = cylinder(group, 0.038, 0.033, 0.017, [-0.179, 1.425, -0.343], NEUTRALS.metal, 32);
  handset.rotation.x = Math.PI / 2;
  const face = cylinder(group, 0.03, 0.03, 0.003, [-0.179, 1.425, -0.332], NEUTRALS.dark, 32);
  face.rotation.x = Math.PI / 2;
  tube(group, [[-0.179, 1.275, -0.352], [-0.239, 0.923, -0.33], [-0.223, 0.614, -0.29], [-0.047, 0.574, -0.29], [0.143, 0.97, -0.349]], 0.007, NEUTRALS.metal);
  return group;
}

export function buildWashingMachine(color: FurnitureColor) {
  const group = modelGroup('washing-machine');
  const palette = FURNITURE_PALETTES[color];
  const enamel = { surface: 'metal' as const, roughness: 0.31, metalness: 0.18 };
  for (const x of [-0.245, 0.245]) {
    for (const z of [-0.249, 0.223]) cylinder(group, 0.026, 0.029, 0.074, [x, 0.037, z], NEUTRALS.dark, 20);
  }
  for (const x of [-0.295, 0.295]) box(group, [0.03, 0.773, 0.616], [x, 0.4465, -0.022], NEUTRALS.cream, 0.009, enamel);
  box(group, [0.567, 0.765, 0.024], [0, 0.448, -0.318], NEUTRALS.cream, 0.007, enamel);
  box(group, [0.576, 0.027, 0.578], [0, 0.074, -0.02], NEUTRALS.dark, 0.006);
  box(group, [0.62, 0.027, 0.66], [0, 0.8465, 0], NEUTRALS.cream, 0.012, enamel);

  const frontGeometry = cachedGeometry('washer-open-front', () => {
    const front = new Shape();
    front.moveTo(-0.277, 0.073);
    front.lineTo(0.277, 0.073);
    front.quadraticCurveTo(0.295, 0.073, 0.295, 0.091);
    front.lineTo(0.295, 0.677);
    front.lineTo(-0.295, 0.677);
    front.lineTo(-0.295, 0.091);
    front.quadraticCurveTo(-0.295, 0.073, -0.277, 0.073);
    const opening = new Path();
    opening.absarc(0, 0.368, 0.207, 0, Math.PI * 2, true);
    front.holes.push(opening);
    return new ExtrudeGeometry(front, {
      depth: 0.019, steps: 1, curveSegments: 48,
      bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3,
    });
  });
  const fascia = new Mesh(frontGeometry, material(palette.fabric, enamel));
  fascia.name = 'washer-open-front';
  fascia.position.z = 0.263;
  fascia.castShadow = fascia.receiveShadow = true;
  group.add(fascia);

  const drum = lathe(group, [[0, -0.22], [0.15, -0.22], [0.185, -0.213], [0.198, -0.197], [0.203, -0.035], [0.203, 0], [0.19, 0], [0.187, -0.03], [0.174, -0.182], [0, -0.186]], [0, 0.368, 0.255], NEUTRALS.metal, { surface: 'metal', roughness: 0.39 });
  drum.name = 'washer-inner-drum';
  drum.rotation.x = Math.PI / 2;
  for (let index = 0; index < 10; index += 1) {
    const angle = index * Math.PI / 5;
    const hole = box(group, [0.012, 0.025, 0.002], [Math.sin(angle) * 0.131, 0.368 + Math.cos(angle) * 0.131, 0.071], NEUTRALS.dark, 0.004);
    hole.rotation.z = -angle;
  }
  for (let index = 0; index < 3; index += 1) {
    const angle = index * Math.PI * 2 / 3;
    const paddle = box(group, [0.034, 0.028, 0.147], [Math.sin(angle) * 0.157, 0.368 + Math.cos(angle) * 0.157, 0.158], NEUTRALS.metal, 0.012);
    paddle.rotation.z = -angle;
  }
  const gasket = lathe(group, [[0.186, -0.017], [0.192, -0.018], [0.211, -0.008], [0.212, 0.008], [0.208, 0.016], [0.19, 0.017], [0.183, 0.006], [0.186, -0.017]], [0, 0.368, 0.28], NEUTRALS.dark, { roughness: 0.77 });
  gasket.rotation.x = Math.PI / 2;
  const door = lathe(group, [[0.169, -0.016], [0.219, -0.016], [0.233, -0.005], [0.235, 0.007], [0.228, 0.018], [0.174, 0.018], [0.165, 0.01], [0.169, -0.016]], [0, 0.368, 0.301], NEUTRALS.metal);
  door.rotation.x = Math.PI / 2;
  torus(group, 0.223, 0.004, [0, 0.368, 0.32], NEUTRALS.cream, enamel);
  const window = lathe(group, [[0, -0.036], [0.05, -0.034], [0.117, -0.023], [0.161, -0.005], [0.17, 0.003], [0.17, 0.008], [0.159, 0], [0.113, -0.017], [0.05, -0.028], [0, -0.03]], [0, 0.368, 0.316], NEUTRALS.glass, { surface: 'plain', roughness: 0.08, metalness: 0.12, transparent: true, opacity: 0.27, doubleSided: true });
  window.name = 'washer-concave-glass';
  window.rotation.x = Math.PI / 2;
  for (const y of [0.3165, 0.4195]) rod(group, [0.226, y, 0.297], [0.226, y, 0.322], 0.005, NEUTRALS.dark, 0.005, { surface: 'metal' });
  rod(group, [0.226, 0.3165, 0.322], [0.226, 0.4195, 0.322], 0.008, NEUTRALS.dark, 0.008, { surface: 'metal' });
  for (const y of [0.295, 0.441]) box(group, [0.029, 0.036, 0.04], [-0.217, y, 0.284], NEUTRALS.metal, 0.007);

  box(group, [0.594, 0.149, 0.039], [0, 0.754, 0.28], NEUTRALS.cream, 0.008, enamel);
  box(group, [0.182, 0.085, 0.013], [-0.191, 0.757, 0.302], NEUTRALS.dark, 0.005);
  box(group, [0.174, 0.077, 0.017], [-0.191, 0.757, 0.308], palette.fabric, 0.007, enamel);
  box(group, [0.103, 0.008, 0.008], [-0.191, 0.737, 0.319], NEUTRALS.metal, 0.003);
  const dial = cylinder(group, 0.033, 0.036, 0.026, [-0.03, 0.754, 0.312], NEUTRALS.metal, 32);
  dial.rotation.x = Math.PI / 2;
  box(group, [0.003, 0.014, 0.002], [-0.03, 0.772, 0.326], NEUTRALS.dark, 0.001);
  const panel = box(group, [0.172, 0.058, 0.01], [0.153, 0.765, 0.306], NEUTRALS.dark, 0.006);
  panel.material = screenMaterial();
  for (const x of [0.103, 0.129, 0.155]) box(group, [0.015, 0.025, 0.002], [x, 0.765, 0.312], palette.accent, 0.002, { surface: 'plain' });
  for (const x of [0.129, 0.187, 0.245]) box(group, [0.032, 0.009, 0.012], [x, 0.713, 0.311], NEUTRALS.metal, 0.004);
  box(group, [0.564, 0.046, 0.019], [0, 0.102, 0.293], NEUTRALS.cream, 0.007, enamel);
  box(group, [0.073, 0.032, 0.005], [0.208, 0.105, 0.305], palette.fabric, 0.008, enamel);
  return group;
}
