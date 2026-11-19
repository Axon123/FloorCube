import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Position = [number, number, number];
type Size = [number, number, number];

interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
}

const geometries = new Map<string, BufferGeometry>();
const materials = new Map<string, MeshStandardMaterial>();

function cachedGeometry(key: string, create: () => BufferGeometry) {
  if (!geometries.has(key)) {
    const geometry = create();
    geometry.userData.shared = true;
    geometries.set(key, geometry);
  }
  return geometries.get(key)!;
}

export function material(color: number, options: MaterialOptions = {}) {
  const { roughness = 0.76, metalness = 0, transparent = false, opacity = 1 } = options;
  const key = `${color}-${roughness}-${metalness}-${transparent}-${opacity}`;
  if (!materials.has(key)) {
    const created = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent,
      opacity,
      depthWrite: !transparent,
    });
    created.userData.shared = true;
    materials.set(key, created);
  }
  return materials.get(key)!;
}

function addMesh(parent: Group, geometry: BufferGeometry, color: number, position: Position, options?: MaterialOptions) {
  const mesh = new Mesh(geometry, material(color, options));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function box(parent: Group, size: Size, position: Position, color: number, radius = 0.025) {
  const safeRadius = Math.min(radius, ...size.map((value) => value / 3));
  const key = `box-${size.join('-')}-${safeRadius}`;
  const geometry = cachedGeometry(key, () => safeRadius > 0
    ? new RoundedBoxGeometry(...size, 2, safeRadius)
    : new BoxGeometry(...size));
  return addMesh(parent, geometry, color, position);
}

export function cylinder(
  parent: Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Position,
  color: number,
  segments = 16,
) {
  const key = `cylinder-${radiusTop}-${radiusBottom}-${height}-${segments}`;
  const geometry = cachedGeometry(key, () => new CylinderGeometry(radiusTop, radiusBottom, height, segments));
  return addMesh(parent, geometry, color, position);
}

export function pebble(parent: Group, radius: number, position: Position, color: number, detail = 1) {
  const key = `pebble-${radius}-${detail}`;
  const geometry = cachedGeometry(key, () => new IcosahedronGeometry(radius, detail));
  return addMesh(parent, geometry, color, position);
}

export function torus(parent: Group, radius: number, tube: number, position: Position, color: number) {
  const key = `torus-${radius}-${tube}`;
  const geometry = cachedGeometry(key, () => new TorusGeometry(radius, tube, 8, 20));
  return addMesh(parent, geometry, color, position);
}

export function glass(parent: Group, size: Size, position: Position) {
  return addMesh(parent, new BoxGeometry(...size), 0xb9dfe0, position, {
    roughness: 0.18,
    transparent: true,
    opacity: 0.28,
  });
}

export function modelGroup(id: string) {
  const group = new Group();
  group.name = id;
  return group;
}

export function screenMaterial() {
  return new MeshStandardMaterial({
    color: new Color(0x263735),
    roughness: 0.3,
    metalness: 0.1,
    emissive: new Color(0x172524),
    emissiveIntensity: 0.35,
  });
}
