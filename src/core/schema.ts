import { FURNITURE_CATALOG } from '../models/catalog';
import type { FurnitureModelId } from '../models/catalog';
import type { FurnitureColor } from '../models/types';
import { clamp, planBounds, polygonArea } from './geometry';
import type { Vec2 } from './geometry';

export const ROOM_TYPES = [
  { id: 'bedroom', name: '卧室', color: 0xd9c6a5 },
  { id: 'living', name: '客厅', color: 0xcfd8c3 },
  { id: 'kitchen', name: '厨房', color: 0xd8cfc0 },
  { id: 'bathroom', name: '卫生间', color: 0xc3d4d8 },
  { id: 'balcony', name: '阳台', color: 0xd7dcc8 },
  { id: 'dining', name: '餐厅', color: 0xe0d2b8 },
  { id: 'study', name: '书房', color: 0xcbd2c0 },
  { id: 'entry', name: '玄关', color: 0xd8d2c8 },
  { id: 'other', name: '其他', color: 0xd5d0c8 },
] as const;

export type RoomType = (typeof ROOM_TYPES)[number]['id'];
export type ScaleSource = 'annotation' | 'door-reference' | 'user-calibrated';

export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  confidence?: number;
}

export interface Opening {
  id: string;
  wallId: string;
  type: 'door' | 'window';
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  polygon: Vec2[];
  confidence: number;
}

export interface FurnitureItem {
  id: string;
  model: FurnitureModelId;
  roomId?: string;
  position: Vec2;
  rotation: number;
  color: FurnitureColor;
}

export interface FloorPlan {
  version: 1;
  name: string;
  unit: 'm';
  scaleSource: ScaleSource;
  totalAreaHint?: number;
  wallHeight: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

let idCounter = 0;
export function uid(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function roomTypeName(type: RoomType) {
  return ROOM_TYPES.find((item) => item.id === type)?.name ?? '其他';
}

export function roomColor(type: RoomType) {
  return ROOM_TYPES.find((item) => item.id === type)?.color ?? 0xd5d0c8;
}

export function wallLength(wall: Wall) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

export function planArea(plan: FloorPlan) {
  return plan.rooms.reduce((sum, room) => sum + polygonArea(room.polygon), 0);
}

export function allPlanPoints(plan: FloorPlan): Vec2[] {
  return [
    ...plan.walls.flatMap((wall) => [wall.start, wall.end]),
    ...plan.rooms.flatMap((room) => room.polygon),
    ...plan.furniture.map((item) => item.position),
  ];
}

export function emptyPlan(name = '未命名户型'): FloorPlan {
  return {
    version: 1,
    name,
    unit: 'm',
    scaleSource: 'door-reference',
    wallHeight: 2.8,
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
  };
}

const modelIds = new Set<string>(FURNITURE_CATALOG.map((item) => item.id));
const colorIds = new Set<string>(['walnut', 'oak', 'sage']);
const roomTypeIds = new Set<string>(ROOM_TYPES.map((item) => item.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pointOr(value: unknown, fallback: Vec2): Vec2 {
  if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return [Number(value[0]), Number(value[1])];
  }
  return fallback;
}

function polygonOr(value: unknown): Vec2[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const polygon = value.map((point) => pointOr(point, [NaN, NaN]));
  return polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? polygon : null;
}

export function normalizeFloorPlan(raw: unknown, fallbackName = '识别结果'): FloorPlan {
  if (!isRecord(raw)) throw new Error('模型没有返回有效的户型 JSON。');
  const plan = emptyPlan(typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : fallbackName);
  plan.scaleSource = raw.scaleSource === 'annotation' || raw.scaleSource === 'user-calibrated' ? raw.scaleSource : 'door-reference';
  plan.wallHeight = clamp(numberOr(raw.wallHeight, 2.8), 2.2, 4.5);
  if (typeof raw.totalAreaHint === 'number' && raw.totalAreaHint > 0) plan.totalAreaHint = raw.totalAreaHint;

  const walls: Wall[] = [];
  if (Array.isArray(raw.walls)) {
    for (const item of raw.walls) {
      if (!isRecord(item)) continue;
      const start = pointOr(item.start, [NaN, NaN]);
      const end = pointOr(item.end, [NaN, NaN]);
      if (!Number.isFinite(start[0]) || !Number.isFinite(end[0]) || wallLength({ id: '', start, end, thickness: 0 }) < 0.05) continue;
      walls.push({
        id: typeof item.id === 'string' ? item.id : uid('w'),
        start,
        end,
        thickness: clamp(numberOr(item.thickness, 0.24), 0.08, 0.5),
        confidence: clamp(numberOr(item.confidence, 0.9), 0, 1),
      });
    }
  }

  const rooms: Room[] = [];
  if (Array.isArray(raw.rooms)) {
    for (const item of raw.rooms) {
      if (!isRecord(item)) continue;
      const polygon = polygonOr(item.polygon);
      if (!polygon || polygonArea(polygon) < 0.5) continue;
      rooms.push({
        id: typeof item.id === 'string' ? item.id : uid('r'),
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 20) : '房间',
        type: roomTypeIds.has(String(item.type)) ? item.type as RoomType : 'other',
        polygon,
        confidence: clamp(numberOr(item.confidence, 0.85), 0, 1),
      });
    }
  }

  if (rooms.length === 0 && walls.length > 0) {
    const bounds = planBounds(walls.flatMap((wall) => [wall.start, wall.end]));
    rooms.push({
      id: uid('r'),
      name: '主空间',
      type: 'living',
      polygon: [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]],
      confidence: 0.5,
    });
  }

  if (walls.length === 0 && rooms.length > 0) {
    const seen = new Set<string>();
    for (const room of rooms) {
      for (let index = 0; index < room.polygon.length; index += 1) {
        const start = room.polygon[index];
        const end = room.polygon[(index + 1) % room.polygon.length];
        const key = [start, end].map((point) => point.map((value) => value.toFixed(2)).join(',')).sort().join('|');
        if (seen.has(key) || wallLength({ id: '', start, end, thickness: 0 }) < 0.05) continue;
        seen.add(key);
        walls.push({ id: uid('w'), start: [...start], end: [...end], thickness: 0.24, confidence: room.confidence });
      }
    }
  }

  if (walls.length === 0 || rooms.length === 0) {
    throw new Error('识别结果缺少可生成的墙体或房间，请更换模型重试，或使用 2D 手动描绘。');
  }

  const wallIds = new Set(walls.map((wall) => wall.id));
  const openings: Opening[] = [];
  if (Array.isArray(raw.openings)) {
    for (const item of raw.openings) {
      if (!isRecord(item) || typeof item.wallId !== 'string' || !wallIds.has(item.wallId)) continue;
      const wall = walls.find((candidate) => candidate.id === item.wallId)!;
      const length = wallLength(wall);
      const width = clamp(numberOr(item.width, item.type === 'window' ? 1.2 : 0.9), 0.4, Math.max(0.4, length - 0.1));
      const offset = clamp(numberOr(item.offset, 0.2), 0, Math.max(0, length - width));
      openings.push({
        id: typeof item.id === 'string' ? item.id : uid('o'),
        wallId: item.wallId,
        type: item.type === 'window' ? 'window' : 'door',
        offset,
        width,
        height: clamp(numberOr(item.height, item.type === 'window' ? 1.2 : 2.1), 0.4, plan.wallHeight),
        sillHeight: clamp(numberOr(item.sillHeight, item.type === 'window' ? 0.9 : 0), 0, plan.wallHeight - 0.3),
      });
    }
  }

  const roomIds = new Set(rooms.map((room) => room.id));
  const furniture: FurnitureItem[] = [];
  if (Array.isArray(raw.furniture)) {
    for (const item of raw.furniture) {
      if (!isRecord(item) || typeof item.model !== 'string' || !modelIds.has(item.model)) continue;
      const position = pointOr(item.position, [NaN, NaN]);
      if (!Number.isFinite(position[0])) continue;
      furniture.push({
        id: typeof item.id === 'string' ? item.id : uid('f'),
        model: item.model as FurnitureModelId,
        roomId: typeof item.roomId === 'string' && roomIds.has(item.roomId) ? item.roomId : undefined,
        position,
        rotation: numberOr(item.rotation, 0),
        color: colorIds.has(String(item.color)) ? item.color as FurnitureColor : 'walnut',
      });
    }
  }

  plan.walls = walls;
  plan.rooms = rooms;
  plan.openings = openings;
  plan.furniture = furniture;
  return plan;
}

export function scalePlan(plan: FloorPlan, factor: number, source: ScaleSource, areaHint?: number): FloorPlan {
  const points = allPlanPoints(plan);
  const bounds = planBounds(points);
  const scalePoint = (point: Vec2): Vec2 => [
    bounds.minX + (point[0] - bounds.minX) * factor,
    bounds.minY + (point[1] - bounds.minY) * factor,
  ];
  return {
    ...plan,
    scaleSource: source,
    totalAreaHint: areaHint ?? plan.totalAreaHint,
    walls: plan.walls.map((wall) => ({ ...wall, start: scalePoint(wall.start), end: scalePoint(wall.end) })),
    openings: plan.openings.map((opening) => ({ ...opening, offset: opening.offset * factor, width: opening.width * factor })),
    rooms: plan.rooms.map((room) => ({ ...room, polygon: room.polygon.map(scalePoint) })),
    furniture: plan.furniture.map((item) => ({ ...item, position: scalePoint(item.position) })),
  };
}
