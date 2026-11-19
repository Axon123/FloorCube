import { planBounds } from './geometry';
import type { Vec2 } from './geometry';
import { validateFurniture } from './placement';
import { uid } from './schema';
import type { FloorPlan, Room, RoomType } from './schema';
import type { FurnitureModelId } from '../models/catalog';
import type { FurnitureColor } from '../models/types';

const PRESETS: Record<RoomType, Array<{ model: FurnitureModelId; rotation: number }>> = {
  bedroom: [
    { model: 'bed-double', rotation: 0 },
    { model: 'nightstand', rotation: 0 },
    { model: 'wardrobe', rotation: Math.PI },
  ],
  living: [
    { model: 'rug', rotation: 0 },
    { model: 'sofa', rotation: Math.PI },
    { model: 'tv-console', rotation: 0 },
    { model: 'coffee-table', rotation: 0 },
    { model: 'plant', rotation: 0 },
  ],
  kitchen: [
    { model: 'kitchen-cabinet', rotation: Math.PI },
    { model: 'stove', rotation: Math.PI },
    { model: 'fridge', rotation: 0 },
  ],
  bathroom: [
    { model: 'shower', rotation: 0 },
    { model: 'toilet', rotation: Math.PI },
    { model: 'vanity', rotation: -Math.PI / 2 },
  ],
  dining: [
    { model: 'dining-table', rotation: 0 },
    { model: 'dining-chair', rotation: Math.PI / 2 },
    { model: 'dining-chair', rotation: -Math.PI / 2 },
    { model: 'dining-chair', rotation: Math.PI },
    { model: 'dining-chair', rotation: 0 },
  ],
  study: [
    { model: 'desk', rotation: Math.PI },
    { model: 'dining-chair', rotation: 0 },
    { model: 'bookshelf', rotation: -Math.PI / 2 },
  ],
  balcony: [
    { model: 'plant', rotation: 0 },
    { model: 'accent-chair', rotation: Math.PI },
  ],
  entry: [{ model: 'plant', rotation: 0 }],
  other: [{ model: 'plant', rotation: 0 }],
};

function findSpot(plan: FloorPlan, room: Room, model: FurnitureModelId, preferredRotation: number): { position: Vec2; rotation: number } | null {
  const bounds = planBounds(room.polygon);
  const rotations = [preferredRotation, 0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const step = 0.25;
  for (const rotation of rotations) {
    for (let y = bounds.minY + 0.35; y <= bounds.maxY - 0.35; y += step) {
      for (let x = bounds.minX + 0.35; x <= bounds.maxX - 0.35; x += step) {
        const position: Vec2 = [Math.round(x * 20) / 20, Math.round(y * 20) / 20];
        if (validateFurniture(plan, model, position, rotation).valid) return { position, rotation };
      }
    }
  }
  return null;
}

export function smartLayout(plan: FloorPlan, color: FurnitureColor = 'oak'): FloorPlan {
  const next: FloorPlan = { ...plan, furniture: [] };
  const rooms = [...plan.rooms].sort((a, b) => planBounds(b.polygon).width * planBounds(b.polygon).depth - planBounds(a.polygon).width * planBounds(a.polygon).depth);
  for (const room of rooms) {
    const preset = PRESETS[room.type] ?? PRESETS.other;
    for (const item of preset) {
      const spot = findSpot(next, room, item.model, item.rotation);
      if (!spot) continue;
      next.furniture.push({
        id: uid('f'),
        model: item.model,
        roomId: room.id,
        position: spot.position,
        rotation: spot.rotation,
        color,
      });
    }
  }
  return next;
}
