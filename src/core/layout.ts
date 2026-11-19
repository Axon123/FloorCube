import { clamp, distanceToSegment, planBounds, pointInPolygon } from './geometry';
import type { Vec2 } from './geometry';
import { furnitureCorners, validateFurniture } from './placement';
import { uid } from './schema';
import type { FloorPlan, FurnitureItem, Room, RoomType } from './schema';
import { getFurnitureDefinition } from '../models/catalog';
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

const WALL_FRONT_CLEARANCE: Partial<Record<FurnitureModelId, number>> = {
  toilet: 0.55,
  'bed-double': 0.45,
  'bed-single': 0.45,
  sofa: 0.4,
  wardrobe: 0.4,
  desk: 0.4,
  vanity: 0.4,
  'kitchen-cabinet': 0.35,
  stove: 0.35,
  bookshelf: 0.3,
  'tv-console': 0.3,
  fridge: 0.4,
};

function angleDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function rotationsFor(preferred: number) {
  return [preferred, 0, Math.PI / 2, Math.PI, -Math.PI / 2]
    .filter((rotation, index, all) => all.findIndex((other) => angleDistance(rotation, other) < 0.001) === index);
}

function orientationScore(plan: FloorPlan, room: Room, model: FurnitureModelId, position: Vec2, rotation: number) {
  const clearance = WALL_FRONT_CLEARANCE[model];
  if (clearance === undefined) return 0;
  const dimensions = getFurnitureDefinition(model).dimensions;
  const front: Vec2 = [Math.sin(rotation), Math.cos(rotation)];
  const backPoint: Vec2 = [
    position[0] - front[0] * dimensions.depth / 2,
    position[1] - front[1] * dimensions.depth / 2,
  ];
  let wallDistance = Infinity;
  for (let index = 0; index < room.polygon.length; index += 1) {
    wallDistance = Math.min(wallDistance, distanceToSegment(backPoint, room.polygon[index], room.polygon[(index + 1) % room.polygon.length]));
  }
  const frontPoint: Vec2 = [
    position[0] + front[0] * (dimensions.depth / 2 + clearance),
    position[1] + front[1] * (dimensions.depth / 2 + clearance),
  ];
  let frontClear = pointInPolygon(frontPoint, room.polygon);
  if (frontClear) {
    for (const wall of plan.walls) {
      if (distanceToSegment(frontPoint, wall.start, wall.end) < wall.thickness / 2 + 0.04) {
        frontClear = false;
        break;
      }
    }
  }
  if (frontClear) {
    for (const other of plan.furniture) {
      if (other.model !== 'rug' && pointInPolygon(frontPoint, furnitureCorners(other))) {
        frontClear = false;
        break;
      }
    }
  }
  return clamp(1 - wallDistance / 0.55, 0, 1) * 2 + (frontClear ? 1 : 0);
}

interface Spot {
  position: Vec2;
  rotation: number;
  roomId?: string;
}

function bestRotationAt(plan: FloorPlan, model: FurnitureModelId, position: Vec2, preferredRotation: number): Spot | null {
  let best: Spot | null = null;
  let bestScore = -Infinity;
  for (const rotation of rotationsFor(preferredRotation)) {
    const result = validateFurniture(plan, model, position, rotation);
    if (!result.valid) continue;
    const room = plan.rooms.find((candidate) => candidate.id === result.roomId);
    const score = (room ? orientationScore(plan, room, model, position, rotation) : 0)
      + (angleDistance(rotation, preferredRotation) < 0.001 ? 0.03 : 0);
    if (score > bestScore) {
      best = { position, rotation, roomId: result.roomId };
      bestScore = score;
    }
  }
  return best;
}

function findSpot(plan: FloorPlan, room: Room, model: FurnitureModelId, preferredRotation: number): Spot | null {
  const bounds = planBounds(room.polygon);
  const step = 0.25;
  for (let y = bounds.minY + 0.35; y <= bounds.maxY - 0.35; y += step) {
    for (let x = bounds.minX + 0.35; x <= bounds.maxX - 0.35; x += step) {
      const position: Vec2 = [Math.round(x * 20) / 20, Math.round(y * 20) / 20];
      const spot = bestRotationAt(plan, model, position, preferredRotation);
      if (spot) return spot;
    }
  }
  return null;
}

function nearestValidSpot(plan: FloorPlan, item: FurnitureItem): Spot | null {
  const original = bestRotationAt(plan, item.model, item.position, item.rotation);
  if (original) return original;
  const step = 0.2;
  for (let ring = 1; ring <= 6; ring += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      for (let y = -ring; y <= ring; y += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        const position: Vec2 = [item.position[0] + x * step, item.position[1] + y * step];
        const spot = bestRotationAt(plan, item.model, position, item.rotation);
        if (spot) return spot;
      }
    }
  }
  return null;
}

export function constrainFurnitureLayout(plan: FloorPlan) {
  const next: FloorPlan = { ...plan, furniture: [] };
  let adjusted = 0;
  let unplaced = 0;
  for (const item of plan.furniture) {
    const spot = nearestValidSpot(next, item);
    if (!spot) {
      unplaced += 1;
      continue;
    }
    if (angleDistance(spot.rotation, item.rotation) > 0.001
      || Math.hypot(spot.position[0] - item.position[0], spot.position[1] - item.position[1]) > 0.001) {
      adjusted += 1;
    }
    next.furniture.push({ ...item, position: spot.position, rotation: spot.rotation, roomId: spot.roomId ?? item.roomId });
  }
  return { plan: next, adjusted, unplaced };
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
