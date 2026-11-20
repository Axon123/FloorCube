import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG, createFurnitureModel } from './catalog';
import { material } from './primitives';
import { FURNITURE_PALETTES, NEUTRALS } from './palette';
import type { FurnitureColor } from './types';

const colors: FurnitureColor[] = ['walnut', 'oak', 'sage'];

function meshes(model: ReturnType<typeof createFurnitureModel>) {
  const result: Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof Mesh) result.push(child);
  });
  return result;
}

describe('furniture catalog', () => {
  it('contains 34 unique models in five categories', () => {
    expect(FURNITURE_CATALOG).toHaveLength(34);
    expect(new Set(FURNITURE_CATALOG.map((item) => item.id)).size).toBe(34);
    expect(new Set(FURNITURE_CATALOG.map((item) => item.category))).toEqual(
      new Set(['bedroom', 'living', 'kitchen', 'bathroom', 'general']),
    );
  });

  it.each(FURNITURE_CATALOG.map((item) => item.id))('builds %s on the floor within its dimensions in every color', (id) => {
    const definition = FURNITURE_CATALOG.find((item) => item.id === id)!;
    for (const color of colors) {
      const model = createFurnitureModel(id, color);
      expect(model.children.length).toBeGreaterThan(0);
      expect(model.userData.modelId).toBe(id);
      expect(model.userData.color).toBe(color);

      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      expect(Number.isFinite(size.length())).toBe(true);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.015);
      expect(bounds.min.y).toBeLessThanOrEqual(0.025);
      expect(bounds.max.y).toBeLessThanOrEqual(definition.dimensions.height + 0.02);
      expect(size.x).toBeLessThanOrEqual(definition.dimensions.width + 0.02);
      expect(size.z).toBeLessThanOrEqual(definition.dimensions.depth + 0.02);
      expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThanOrEqual(definition.dimensions.width / 2 + 0.02);
      expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThanOrEqual(definition.dimensions.depth / 2 + 0.02);
      expect(size.x).toBeGreaterThan(definition.dimensions.width * 0.45);
      expect(size.z).toBeGreaterThan(definition.dimensions.depth * 0.45);
    }
  });

  it.each(FURNITURE_CATALOG.map((item) => item.id))('shares %s resources while keeping geometry within the interactive budget', (id) => {
    const first = meshes(createFurnitureModel(id));
    const second = meshes(createFurnitureModel(id));
    let triangles = 0;
    expect(first.length).toBeLessThanOrEqual(140);
    expect(second).toHaveLength(first.length);
    first.forEach((mesh, index) => {
      expect(mesh.geometry).toBe(second[index].geometry);
      expect(mesh.material).toBe(second[index].material);
      expect(mesh.geometry.userData.shared).toBe(true);
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const entry of materials) {
        expect(entry.userData.shared).toBe(true);
        expect(entry).toBeInstanceOf(MeshStandardMaterial);
      }
    });
    expect(triangles).toBeLessThanOrEqual(100_000);
  });

  it.each(['bed-double', 'bed-single'] as const)('keeps the %s draped cover above the mattress', (id) => {
    const model = createFurnitureModel(id);
    model.updateMatrixWorld(true);
    const cover = model.getObjectByName('bed-draped-cover')!;
    const mattress = model.getObjectByName('bed-mattress-topper')!;
    const width = FURNITURE_CATALOG.find((item) => item.id === id)!.dimensions.width;
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    let samples = 0;
    for (let column = 0; column <= 40; column += 1) {
      for (let row = 0; row <= 20; row += 1) {
        ray.ray.origin.set((column / 40 - 0.5) * (width - 0.06), 2, row / 20 * 0.93);
        const top = ray.intersectObject(mattress)[0];
        const cloth = ray.intersectObject(cover)[0];
        if (!top || !cloth) continue;
        expect(cloth.point.y - top.point.y).toBeGreaterThan(0.002);
        samples += 1;
      }
    }
    expect(samples).toBeGreaterThan(600);
  });

  it('distinguishes woven fabric, wood grain, ceramic and metal with reusable materials', () => {
    const wood = material(FURNITURE_PALETTES.oak.wood);
    const fabric = material(FURNITURE_PALETTES.oak.fabric);
    const ceramic = material(NEUTRALS.white);
    const metal = material(NEUTRALS.metal);
    expect(wood.bumpMap).not.toBeNull();
    expect(wood.map).toBe(wood.bumpMap);
    expect(wood.roughnessMap).toBeNull();
    expect(fabric.bumpMap).not.toBeNull();
    expect(wood.bumpMap).not.toBe(fabric.bumpMap);
    expect(fabric.roughness).toBeGreaterThan(wood.roughness);
    expect(ceramic.roughness).toBeLessThan(fabric.roughness);
    expect(metal.metalness).toBeGreaterThan(0.5);
    expect(material(FURNITURE_PALETTES.sage.wood).bumpMap).toBe(wood.bumpMap);
    expect(material(NEUTRALS.white, { surface: 'fabric' }).bumpMap).toBe(fabric.bumpMap);
  });
});
