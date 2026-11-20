import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FURNITURE_PALETTES, NEUTRALS } from './palette';

type Position = [number, number, number];
type Size = [number, number, number];
type Surface = 'wood' | 'fabric' | 'ceramic' | 'metal' | 'stone' | 'plain';

export interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  surface?: Surface;
  doubleSided?: boolean;
}

const geometries = new Map<string, BufferGeometry>();
const materials = new Map<string, MeshStandardMaterial>();
const textures = new Map<string, DataTexture>();
const woodColors = new Set(Object.values(FURNITURE_PALETTES).map((palette) => palette.wood));
const fabricColors = new Set(Object.values(FURNITURE_PALETTES).flatMap((palette) => [palette.fabric, palette.accent]));

export function cachedGeometry(key: string, create: () => BufferGeometry) {
  if (!geometries.has(key)) {
    const geometry = create();
    geometry.userData.shared = true;
    geometries.set(key, geometry);
  }
  return geometries.get(key)!;
}

function surfaceTexture(surface: 'wood' | 'fabric' | 'stone') {
  if (!textures.has(surface)) {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size * Math.PI * 2;
        const v = y / size * Math.PI * 2;
        let value: number;
        if (surface === 'wood') {
          const grain = u * 14 + Math.sin(v) * 1.6 + Math.sin(v * 3 + u) * 0.45;
          value = 228 + Math.sin(grain) * 14 + Math.sin(grain * 3) * 5 + Math.sin(u * 39 + v * 2) * 3;
        } else if (surface === 'fabric') {
          value = 175 + Math.sin(u * 32) * 25 + Math.sin(v * 32) * 25 + Math.cos(u * 16 + v * 16) * 10;
        } else {
          value = 210 + Math.sin(u * 2 + Math.sin(v * 3)) * 13 + Math.sin(u * 11 + v * 7) * 6;
        }
        const index = (y * size + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = Math.round(value);
        data[index + 3] = 255;
      }
    }
    const texture = new DataTexture(data, size, size, RGBAFormat);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.repeat.set(surface === 'fabric' ? 3 : 1, surface === 'fabric' ? 3 : 1);
    texture.needsUpdate = true;
    textures.set(surface, texture);
  }
  return textures.get(surface)!;
}

export function material(color: number, options: MaterialOptions = {}) {
  const surface = options.surface ?? (woodColors.has(color) ? 'wood' : fabricColors.has(color) ? 'fabric'
    : color === NEUTRALS.metal ? 'metal' : color === NEUTRALS.white || color === NEUTRALS.cream ? 'ceramic' : 'plain');
  const { roughness = surface === 'metal' ? 0.27 : surface === 'ceramic' ? 0.24 : surface === 'wood' ? 0.48 : 0.86,
    metalness = surface === 'metal' ? 0.78 : 0, transparent = false, opacity = 1, doubleSided = false } = options;
  const key = `${color}-${surface}-${roughness}-${metalness}-${transparent}-${opacity}-${doubleSided}`;
  if (!materials.has(key)) {
    const texture = surface === 'wood' || surface === 'fabric' || surface === 'stone' ? surfaceTexture(surface) : null;
    const created = new MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent,
      opacity,
      depthWrite: !transparent,
      map: surface === 'wood' ? texture : null,
      bumpMap: texture,
      bumpScale: surface === 'wood' ? 0.0015 : 0.0006,
      roughnessMap: surface === 'stone' ? texture : null,
      ...(doubleSided ? { side: DoubleSide } : {}),
    });
    created.userData.shared = true;
    created.userData.surface = surface;
    materials.set(key, created);
  }
  return materials.get(key)!;
}

function addMesh(parent: Group, geometry: BufferGeometry, color: number, position: Position, options?: MaterialOptions) {
  const mesh = new Mesh(geometry, material(color, options));
  mesh.position.set(...position);
  mesh.castShadow = !options?.transparent;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function box(parent: Group, size: Size, position: Position, color: number, radius = 0.025, options?: MaterialOptions) {
  const safeRadius = Math.min(radius, ...size.map((value) => value / 2));
  const key = `box-${size.join('-')}-${safeRadius}`;
  const geometry = cachedGeometry(key, () => safeRadius > 0
    ? new RoundedBoxGeometry(...size, 3, safeRadius)
    : new BoxGeometry(...size));
  return addMesh(parent, geometry, color, position, options);
}

export function cylinder(
  parent: Group,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Position,
  color: number,
  segments = 32,
  options?: MaterialOptions,
) {
  const key = `cylinder-${radiusTop}-${radiusBottom}-${height}-${segments}`;
  const geometry = cachedGeometry(key, () => new CylinderGeometry(radiusTop, radiusBottom, height, segments));
  return addMesh(parent, geometry, color, position, options);
}

export function ellipsoid(parent: Group, size: Size, position: Position, color: number, options?: MaterialOptions) {
  const geometry = cachedGeometry('sphere-32-20', () => new SphereGeometry(1, 32, 20));
  const mesh = addMesh(parent, geometry, color, position, options);
  mesh.scale.set(size[0] / 2, size[1] / 2, size[2] / 2);
  return mesh;
}

export function torus(parent: Group, radius: number, tubeRadius: number, position: Position, color: number, options?: MaterialOptions) {
  const key = `torus-${radius}-${tubeRadius}`;
  const geometry = cachedGeometry(key, () => new TorusGeometry(radius, tubeRadius, 10, 48));
  return addMesh(parent, geometry, color, position, options);
}

export function rod(parent: Group, start: Position, end: Position, radius: number, color: number, endRadius = radius, options?: MaterialOptions) {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const direction = to.clone().sub(from);
  const center = from.add(to).multiplyScalar(0.5);
  const mesh = cylinder(parent, endRadius, radius, direction.length(), center.toArray() as Position, color, 20, options);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

export function tube(parent: Group, points: Position[], radius: number, color: number, closed = false, options?: MaterialOptions) {
  const key = `tube-${JSON.stringify(points)}-${radius}-${closed}`;
  const geometry = cachedGeometry(key, () => new TubeGeometry(
    new CatmullRomCurve3(points.map((point) => new Vector3(...point)), closed, 'centripetal'),
    Math.max(24, points.length * 6), radius, 8, closed,
  ));
  return addMesh(parent, geometry, color, [0, 0, 0], options);
}

export function lathe(parent: Group, profile: [number, number][], position: Position, color: number, options?: MaterialOptions) {
  const key = `lathe-${JSON.stringify(profile)}`;
  const geometry = cachedGeometry(key, () => new LatheGeometry(profile.map(([radius, height]) => new Vector2(radius, height)), 48));
  return addMesh(parent, geometry, color, position, options);
}

export function piping(parent: Group, width: number, depth: number, position: Position, color: number, radius = 0.04) {
  const points: Position[] = [];
  const r = Math.min(radius, width / 3, depth / 3);
  for (let corner = 0; corner < 4; corner += 1) {
    const angle = corner * Math.PI / 2;
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - r);
    const cz = (corner < 2 ? 1 : -1) * (depth / 2 - r);
    for (let step = 0; step <= 4; step += 1) {
      const theta = angle + step * Math.PI / 8;
      points.push([cx + Math.cos(theta) * r, 0, cz + Math.sin(theta) * r]);
    }
  }
  const mesh = tube(parent, points, 0.0025, color, true, { surface: 'fabric' });
  mesh.position.set(...position);
  return mesh;
}

export function glass(parent: Group, size: Size, position: Position) {
  const geometry = cachedGeometry(`glass-${size.join('-')}`, () => new BoxGeometry(...size));
  return addMesh(parent, geometry, 0xb9dfe0, position, {
    surface: 'plain', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.22,
  });
}

export function modelGroup(id: string) {
  const group = new Group();
  group.name = id;
  return group;
}

export function screenMaterial() {
  const key = 'screen';
  if (!materials.has(key)) {
    const screen = new MeshStandardMaterial({
      color: new Color(0x263735), roughness: 0.18, metalness: 0.25,
      emissive: new Color(0x172524), emissiveIntensity: 0.35,
    });
    screen.userData.shared = true;
    materials.set(key, screen);
  }
  return materials.get(key)!;
}
