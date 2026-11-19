import { getFurnitureDefinition } from '../models/catalog';
import type { FurnitureModelId } from '../models/catalog';
import { distanceToSegment, pointInPolygon, polygonsIntersect, rectangleCorners } from './geometry';
import type { Vec2 } from './geometry';
import type { FloorPlan, FurnitureItem } from './schema';

export interface PlacementResult {
  valid: boolean;
  reason?: string;
  roomId?: string;
}

function inclusivePointInPolygon(point: Vec2, polygon: Vec2[]) {
  if (pointInPolygon(point, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]) < 0.035) return true;
  }
  return false;
}

function overlapDepth(a: Vec2[], b: Vec2[]) {
  let minimum = Infinity;
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const [x1, y1] = polygon[index];
      const [x2, y2] = polygon[(index + 1) % polygon.length];
      const edgeLength = Math.hypot(x2 - x1, y2 - y1) || 1;
      const axis: Vec2 = [-(y2 - y1) / edgeLength, (x2 - x1) / edgeLength];
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [x, y] of a) {
        const projection = x * axis[0] + y * axis[1];
        minA = Math.min(minA, projection);
        maxA = Math.max(maxA, projection);
      }
      for (const [x, y] of b) {
        const projection = x * axis[0] + y * axis[1];
        minB = Math.min(minB, projection);
        maxB = Math.max(maxB, projection);
      }
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return 0;
      minimum = Math.min(minimum, overlap);
    }
  }
  return minimum;
}

export function furnitureCorners(item: Pick<FurnitureItem, 'model' | 'position' | 'rotation'>, position = item.position, rotation = item.rotation) {
  const definition = getFurnitureDefinition(item.model);
  return rectangleCorners(position, definition.dimensions.width, definition.dimensions.depth, rotation);
}

export function validateFurniture(
  plan: FloorPlan,
  model: FurnitureModelId,
  position: Vec2,
  rotation: number,
  ignoreId?: string,
): PlacementResult {
  const room = plan.rooms.find((candidate) => inclusivePointInPolygon(position, candidate.polygon));
  if (!room) return { valid: false, reason: '请把家具放在房间范围内' };
  const corners = furnitureCorners({ model, position, rotation });
  if (!corners.every((corner) => inclusivePointInPolygon(corner, room.polygon))) {
    return { valid: false, reason: '家具超出房间边界', roomId: room.id };
  }

  if (model !== 'rug') {
    for (const other of plan.furniture) {
      if (other.id === ignoreId || other.model === 'rug') continue;
      const depth = overlapDepth(corners, furnitureCorners(other));
      if (depth > 0.18) return { valid: false, reason: '与其他家具重叠', roomId: room.id };
    }
    for (const wall of plan.walls) {
      const dx = wall.end[0] - wall.start[0];
      const dy = wall.end[1] - wall.start[1];
      const length = Math.hypot(dx, dy) || 1;
      const half = wall.thickness * 0.25;
      const nx = (-dy / length) * half;
      const ny = (dx / length) * half;
      const wallPolygon: Vec2[] = [
        [wall.start[0] + nx, wall.start[1] + ny],
        [wall.end[0] + nx, wall.end[1] + ny],
        [wall.end[0] - nx, wall.end[1] - ny],
        [wall.start[0] - nx, wall.start[1] - ny],
      ];
      if (polygonsIntersect(corners, wallPolygon) && overlapDepth(corners, wallPolygon) > 0.06) {
        return { valid: false, reason: '家具与墙体碰撞', roomId: room.id };
      }
    }
  }
  return { valid: true, roomId: room.id };
}
