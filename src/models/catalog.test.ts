import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG, createFurnitureModel } from './catalog';
import type { FurnitureModelId } from './catalog';
import type { FurnitureColor } from './types';

const colors: FurnitureColor[] = ['walnut', 'oak', 'sage'];

describe('furniture catalog', () => {
  it('contains 22 unique models in five categories', () => {
    expect(FURNITURE_CATALOG).toHaveLength(22);
    expect(new Set(FURNITURE_CATALOG.map((item) => item.id)).size).toBe(22);
    expect(new Set(FURNITURE_CATALOG.map((item) => item.category))).toEqual(
      new Set(['bedroom', 'living', 'kitchen', 'bathroom', 'general']),
    );
  });

  it.each(FURNITURE_CATALOG.map((item) => item.id))('builds %s on the floor within its dimensions in every color', (id) => {
    const definition = FURNITURE_CATALOG.find((item) => item.id === id)!;
    for (const color of colors) {
      const model = createFurnitureModel(id as FurnitureModelId, color);
      expect(model.children.length).toBeGreaterThan(0);
      expect(model.userData.modelId).toBe(id);
      expect(model.userData.color).toBe(color);

      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      expect(Number.isFinite(size.length())).toBe(true);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.015);
      expect(size.x).toBeLessThanOrEqual(definition.dimensions.width + 0.02);
      expect(size.y).toBeLessThanOrEqual(definition.dimensions.height + 0.02);
      expect(size.z).toBeLessThanOrEqual(definition.dimensions.depth + 0.02);
      expect(size.x).toBeGreaterThan(definition.dimensions.width * 0.45);
      expect(size.z).toBeGreaterThan(definition.dimensions.depth * 0.45);
    }
  });
});
