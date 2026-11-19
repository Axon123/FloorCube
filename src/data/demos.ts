import type { FloorPlan, FurnitureItem, Opening, Room, RoomType, Wall } from '../core/schema';
import type { Vec2 } from '../core/geometry';
import type { FurnitureModelId } from '../models/catalog';
import type { FurnitureColor } from '../models/types';

function wall(id: string, start: Vec2, end: Vec2, thickness = 0.24): Wall {
  return { id, start, end, thickness, confidence: 0.98 };
}

function opening(id: string, wallId: string, type: 'door' | 'window', offset: number, width: number): Opening {
  return {
    id,
    wallId,
    type,
    offset,
    width,
    height: type === 'door' ? 2.1 : 1.3,
    sillHeight: type === 'door' ? 0 : 0.9,
  };
}

function room(id: string, name: string, type: RoomType, polygon: Vec2[], confidence = 0.96): Room {
  return { id, name, type, polygon, confidence };
}

function furniture(id: string, model: FurnitureModelId, position: Vec2, rotation = 0, color: FurnitureColor = 'walnut', roomId?: string): FurnitureItem {
  return { id, model, position, rotation, color, roomId };
}

const oneBed: FloorPlan = {
  version: 1,
  name: '暖阳一居',
  unit: 'm',
  scaleSource: 'annotation',
  totalAreaHint: 42,
  wallHeight: 2.8,
  walls: [
    wall('w1', [0, 0], [7.2, 0]),
    wall('w2', [7.2, 0], [7.2, 5.8]),
    wall('w3', [7.2, 5.8], [0, 5.8]),
    wall('w4', [0, 5.8], [0, 0]),
    wall('w5', [4.2, 0], [4.2, 3.6]),
    wall('w6', [0, 3.6], [7.2, 3.6]),
    wall('w7', [2.4, 3.6], [2.4, 5.8]),
    wall('w8', [4.2, 3.6], [4.2, 5.8]),
  ],
  openings: [
    opening('o1', 'w3', 'door', 5.9, 0.9),
    opening('o2', 'w5', 'door', 2.5, 0.9),
    opening('o3', 'w6', 'door', 2.7, 0.8),
    opening('o4', 'w6', 'door', 0.8, 0.9),
    opening('o5', 'w6', 'door', 5.0, 0.9),
    opening('o6', 'w1', 'window', 1.0, 1.8),
    opening('o7', 'w1', 'window', 4.8, 1.6),
    opening('o8', 'w2', 'window', 1.0, 1.4),
    opening('o9', 'w2', 'window', 4.2, 1.2),
  ],
  rooms: [
    room('r1', '客厅', 'living', [[0, 0], [4.2, 0], [4.2, 3.6], [0, 3.6]]),
    room('r2', '主卧', 'bedroom', [[4.2, 0], [7.2, 0], [7.2, 3.6], [4.2, 3.6]]),
    room('r3', '厨房', 'kitchen', [[0, 3.6], [2.4, 3.6], [2.4, 5.8], [0, 5.8]]),
    room('r4', '卫生间', 'bathroom', [[2.4, 3.6], [4.2, 3.6], [4.2, 5.8], [2.4, 5.8]]),
    room('r5', '书房', 'study', [[4.2, 3.6], [7.2, 3.6], [7.2, 5.8], [4.2, 5.8]]),
  ],
  furniture: [
    furniture('f1', 'sofa', [2.1, 2.75], Math.PI, 'sage', 'r1'),
    furniture('f2', 'tv-console', [2.1, 0.35], 0, 'walnut', 'r1'),
    furniture('f3', 'coffee-table', [2.1, 1.7], 0, 'oak', 'r1'),
    furniture('f4', 'rug', [2.1, 1.8], 0, 'sage', 'r1'),
    furniture('f5', 'plant', [0.65, 0.5], 0, 'sage', 'r1'),
    furniture('f6', 'floor-lamp', [3.75, 0.5], 0, 'oak', 'r1'),
    furniture('f7', 'bed-double', [5.7, 1.2], 0, 'walnut', 'r2'),
    furniture('f8', 'nightstand', [4.65, 0.45], 0, 'walnut', 'r2'),
    furniture('f9', 'wardrobe', [6.3, 3.2], Math.PI, 'oak', 'r2'),
    furniture('f10', 'kitchen-cabinet', [1.45, 5.4], Math.PI, 'oak', 'r3'),
    furniture('f11', 'stove', [0.35, 5.4], Math.PI, 'walnut', 'r3'),
    furniture('f12', 'fridge', [2.0, 4.05], 0, 'sage', 'r3'),
    furniture('f13', 'toilet', [3.0, 5.3], Math.PI, 'walnut', 'r4'),
    furniture('f14', 'vanity', [3.85, 4.5], -Math.PI / 2, 'oak', 'r4'),
    furniture('f15', 'desk', [5.7, 5.4], Math.PI, 'walnut', 'r5'),
    furniture('f16', 'dining-chair', [5.7, 4.75], 0, 'oak', 'r5'),
    furniture('f17', 'bookshelf', [6.85, 4.3], -Math.PI / 2, 'sage', 'r5'),
  ],
};

const twoBed: FloorPlan = {
  version: 1,
  name: '双卧家庭',
  unit: 'm',
  scaleSource: 'annotation',
  totalAreaHint: 69,
  wallHeight: 2.8,
  walls: [
    wall('w1', [0, 0], [9.6, 0]),
    wall('w2', [9.6, 0], [9.6, 7.2]),
    wall('w3', [9.6, 7.2], [0, 7.2]),
    wall('w4', [0, 7.2], [0, 0]),
    wall('w5', [4.8, 0], [4.8, 4.2]),
    wall('w6', [7.2, 0], [7.2, 4.2]),
    wall('w7', [0, 4.2], [9.6, 4.2]),
    wall('w8', [3.0, 4.2], [3.0, 7.2]),
    wall('w9', [5.4, 4.2], [5.4, 7.2]),
    wall('w10', [7.2, 4.2], [7.2, 7.2]),
  ],
  openings: [
    opening('o1', 'w3', 'door', 8.4, 0.9),
    opening('o2', 'w5', 'door', 3.0, 0.9),
    opening('o3', 'w6', 'door', 3.0, 0.9),
    opening('o4', 'w7', 'door', 3.6, 0.9),
    opening('o5', 'w7', 'door', 6.0, 0.8),
    opening('o6', 'w7', 'door', 8.0, 0.9),
    opening('o7', 'w1', 'window', 1.2, 2.2),
    opening('o8', 'w1', 'window', 5.3, 1.6),
    opening('o9', 'w1', 'window', 7.7, 1.5),
    opening('o10', 'w2', 'window', 1.2, 1.5),
    opening('o11', 'w2', 'window', 5.0, 1.8),
    opening('o12', 'w4', 'window', 5.2, 1.4),
  ],
  rooms: [
    room('r1', '客厅', 'living', [[0, 0], [4.8, 0], [4.8, 4.2], [0, 4.2]]),
    room('r2', '主卧', 'bedroom', [[4.8, 0], [7.2, 0], [7.2, 4.2], [4.8, 4.2]]),
    room('r3', '次卧', 'bedroom', [[7.2, 0], [9.6, 0], [9.6, 4.2], [7.2, 4.2]]),
    room('r4', '餐厅', 'dining', [[0, 4.2], [3.0, 4.2], [3.0, 7.2], [0, 7.2]]),
    room('r5', '厨房', 'kitchen', [[3.0, 4.2], [5.4, 4.2], [5.4, 7.2], [3.0, 7.2]]),
    room('r6', '卫生间', 'bathroom', [[5.4, 4.2], [7.2, 4.2], [7.2, 7.2], [5.4, 7.2]]),
    room('r7', '阳台', 'balcony', [[7.2, 4.2], [9.6, 4.2], [9.6, 7.2], [7.2, 7.2]]),
  ],
  furniture: [
    furniture('f1', 'sofa', [2.4, 3.1], Math.PI, 'sage', 'r1'),
    furniture('f2', 'tv-console', [2.4, 0.35], 0, 'walnut', 'r1'),
    furniture('f3', 'coffee-table', [2.4, 1.95], 0, 'oak', 'r1'),
    furniture('f4', 'rug', [2.4, 2.0], 0, 'sage', 'r1'),
    furniture('f5', 'accent-chair', [0.7, 2.2], Math.PI / 2, 'oak', 'r1'),
    furniture('f6', 'plant', [4.2, 0.5], 0, 'sage', 'r1'),
    furniture('f7', 'floor-lamp', [0.45, 0.5], 0, 'walnut', 'r1'),
    furniture('f8', 'bed-double', [6.0, 1.25], 0, 'walnut', 'r2'),
    furniture('f9', 'nightstand', [5.04, 0.45], 0, 'walnut', 'r2'),
    furniture('f10', 'nightstand', [6.96, 0.45], 0, 'walnut', 'r2'),
    furniture('f11', 'wardrobe', [6.0, 3.8], Math.PI, 'oak', 'r2'),
    furniture('f12', 'bed-single', [8.4, 1.2], 0, 'oak', 'r3'),
    furniture('f13', 'desk', [9.2, 2.6], -Math.PI / 2, 'walnut', 'r3'),
    furniture('f14', 'dining-chair', [8.6, 2.6], Math.PI / 2, 'oak', 'r3'),
    furniture('f15', 'bookshelf', [7.7, 3.7], Math.PI, 'sage', 'r3'),
    furniture('f16', 'dining-table', [1.5, 5.7], 0, 'oak', 'r4'),
    furniture('f17', 'dining-chair', [0.7, 5.7], Math.PI / 2, 'walnut', 'r4'),
    furniture('f18', 'dining-chair', [2.3, 5.7], -Math.PI / 2, 'walnut', 'r4'),
    furniture('f19', 'dining-chair', [1.5, 6.5], Math.PI, 'walnut', 'r4'),
    furniture('f20', 'dining-chair', [1.5, 4.9], 0, 'walnut', 'r4'),
    furniture('f21', 'kitchen-cabinet', [4.45, 6.8], Math.PI, 'oak', 'r5'),
    furniture('f22', 'stove', [3.35, 6.8], Math.PI, 'walnut', 'r5'),
    furniture('f23', 'fridge', [5.0, 4.7], 0, 'sage', 'r5'),
    furniture('f24', 'toilet', [6.0, 6.7], Math.PI, 'walnut', 'r6'),
    furniture('f25', 'vanity', [6.85, 5.2], -Math.PI / 2, 'oak', 'r6'),
    furniture('f26', 'shower', [6.15, 4.75], 0, 'walnut', 'r6'),
    furniture('f27', 'plant', [8.0, 6.6], 0, 'sage', 'r7'),
    furniture('f28', 'accent-chair', [8.8, 5.4], Math.PI, 'oak', 'r7'),
  ],
};

const threeBed: FloorPlan = {
  version: 1,
  name: '三室朝阳',
  unit: 'm',
  scaleSource: 'annotation',
  totalAreaHint: 101,
  wallHeight: 2.8,
  walls: [
    wall('w1', [0, 0], [12, 0]),
    wall('w2', [12, 0], [12, 8.4]),
    wall('w3', [12, 8.4], [0, 8.4]),
    wall('w4', [0, 8.4], [0, 0]),
    wall('w5', [5.4, 0], [5.4, 4.8]),
    wall('w6', [8.4, 0], [8.4, 4.8]),
    wall('w7', [0, 4.8], [12, 4.8]),
    wall('w8', [3.2, 4.8], [3.2, 8.4]),
    wall('w9', [5.4, 4.8], [5.4, 8.4]),
    wall('w10', [7.4, 4.8], [7.4, 8.4]),
    wall('w11', [9.6, 4.8], [9.6, 8.4]),
  ],
  openings: [
    opening('o1', 'w3', 'door', 10.8, 1.0),
    opening('o2', 'w5', 'door', 3.5, 0.9),
    opening('o3', 'w6', 'door', 3.5, 0.9),
    opening('o4', 'w7', 'door', 4.0, 0.9),
    opening('o5', 'w7', 'door', 6.2, 0.8),
    opening('o6', 'w7', 'door', 8.2, 0.9),
    opening('o7', 'w7', 'door', 10.4, 1.2),
    opening('o8', 'w1', 'window', 1.4, 2.6),
    opening('o9', 'w1', 'window', 6.0, 1.8),
    opening('o10', 'w1', 'window', 9.2, 1.8),
    opening('o11', 'w2', 'window', 1.4, 1.6),
    opening('o12', 'w2', 'window', 6.0, 2.0),
    opening('o13', 'w4', 'window', 6.2, 1.6),
  ],
  rooms: [
    room('r1', '客厅', 'living', [[0, 0], [5.4, 0], [5.4, 4.8], [0, 4.8]]),
    room('r2', '主卧', 'bedroom', [[5.4, 0], [8.4, 0], [8.4, 4.8], [5.4, 4.8]]),
    room('r3', '次卧', 'bedroom', [[8.4, 0], [12, 0], [12, 4.8], [8.4, 4.8]]),
    room('r4', '餐厅', 'dining', [[0, 4.8], [3.2, 4.8], [3.2, 8.4], [0, 8.4]]),
    room('r5', '厨房', 'kitchen', [[3.2, 4.8], [5.4, 4.8], [5.4, 8.4], [3.2, 8.4]]),
    room('r6', '卫生间', 'bathroom', [[5.4, 4.8], [7.4, 4.8], [7.4, 8.4], [5.4, 8.4]]),
    room('r7', '书房', 'study', [[7.4, 4.8], [9.6, 4.8], [9.6, 8.4], [7.4, 8.4]]),
    room('r8', '阳台', 'balcony', [[9.6, 4.8], [12, 4.8], [12, 8.4], [9.6, 8.4]]),
  ],
  furniture: [
    furniture('f1', 'sofa', [2.7, 3.5], Math.PI, 'sage', 'r1'),
    furniture('f2', 'tv-console', [2.7, 0.35], 0, 'walnut', 'r1'),
    furniture('f3', 'coffee-table', [2.7, 2.2], 0, 'oak', 'r1'),
    furniture('f4', 'rug', [2.7, 2.3], 0, 'sage', 'r1'),
    furniture('f5', 'accent-chair', [0.75, 2.5], Math.PI / 2, 'oak', 'r1'),
    furniture('f6', 'bookshelf', [5.05, 1.4], -Math.PI / 2, 'walnut', 'r1'),
    furniture('f7', 'plant', [0.65, 0.5], 0, 'sage', 'r1'),
    furniture('f8', 'floor-lamp', [4.9, 4.2], 0, 'oak', 'r1'),
    furniture('f9', 'bed-double', [6.9, 1.3], 0, 'walnut', 'r2'),
    furniture('f10', 'nightstand', [5.8, 0.45], 0, 'walnut', 'r2'),
    furniture('f11', 'nightstand', [8.0, 0.45], 0, 'walnut', 'r2'),
    furniture('f12', 'wardrobe', [6.9, 4.35], Math.PI, 'oak', 'r2'),
    furniture('f13', 'bed-double', [10.2, 1.3], 0, 'oak', 'r3'),
    furniture('f14', 'nightstand', [9.1, 0.45], 0, 'oak', 'r3'),
    furniture('f15', 'wardrobe', [11.6, 2.6], -Math.PI / 2, 'walnut', 'r3'),
    furniture('f16', 'dining-table', [1.6, 6.6], 0, 'oak', 'r4'),
    furniture('f17', 'dining-chair', [0.75, 6.6], Math.PI / 2, 'walnut', 'r4'),
    furniture('f18', 'dining-chair', [2.45, 6.6], -Math.PI / 2, 'walnut', 'r4'),
    furniture('f19', 'dining-chair', [1.6, 7.45], Math.PI, 'walnut', 'r4'),
    furniture('f20', 'dining-chair', [1.6, 5.75], 0, 'walnut', 'r4'),
    furniture('f21', 'kitchen-cabinet', [4.3, 8.05], Math.PI, 'oak', 'r5'),
    furniture('f22', 'stove', [3.55, 6.5], Math.PI / 2, 'walnut', 'r5'),
    furniture('f23', 'fridge', [5.0, 5.3], 0, 'sage', 'r5'),
    furniture('f24', 'bathtub', [6.4, 7.7], Math.PI, 'walnut', 'r6'),
    furniture('f25', 'vanity', [7.05, 5.6], -Math.PI / 2, 'oak', 'r6'),
    furniture('f26', 'toilet', [5.9, 5.5], 0, 'walnut', 'r6'),
    furniture('f27', 'desk', [8.5, 7.9], Math.PI, 'walnut', 'r7'),
    furniture('f28', 'dining-chair', [8.5, 7.2], 0, 'oak', 'r7'),
    furniture('f29', 'bookshelf', [9.25, 5.8], -Math.PI / 2, 'sage', 'r7'),
    furniture('f30', 'plant', [10.3, 7.7], 0, 'sage', 'r8'),
    furniture('f31', 'accent-chair', [11.2, 6.0], Math.PI, 'oak', 'r8'),
    furniture('f32', 'rug', [10.8, 6.6], 0, 'oak', 'r8'),
  ],
};

const lShape: FloorPlan = {
  version: 1,
  name: '折线手枪户型',
  unit: 'm',
  scaleSource: 'door-reference',
  totalAreaHint: 44,
  wallHeight: 2.8,
  walls: [
    wall('w1', [0, 0], [8, 0]),
    wall('w2', [8, 0], [8, 3]),
    wall('w3', [8, 3], [5, 3]),
    wall('w4', [5, 3], [5, 7]),
    wall('w5', [5, 7], [0, 7]),
    wall('w6', [0, 7], [0, 0]),
    wall('w7', [5, 0], [5, 3]),
    wall('w8', [0, 3], [5, 3]),
    wall('w9', [2.5, 3], [2.5, 7]),
    wall('w10', [2.5, 5], [5, 5]),
  ],
  openings: [
    opening('o1', 'w5', 'door', 4.0, 0.9),
    opening('o2', 'w7', 'door', 1.9, 0.9),
    opening('o3', 'w8', 'door', 0.8, 0.9),
    opening('o4', 'w8', 'door', 3.2, 0.8),
    opening('o5', 'w10', 'door', 1.2, 0.9),
    opening('o6', 'w1', 'window', 1.2, 2.0),
    opening('o7', 'w1', 'window', 5.8, 1.6),
    opening('o8', 'w2', 'window', 0.9, 1.4),
    opening('o9', 'w6', 'window', 4.8, 1.4),
    opening('o10', 'w4', 'window', 4.6, 1.2),
  ],
  rooms: [
    room('r1', '客厅', 'living', [[0, 0], [5, 0], [5, 3], [0, 3]], 0.9),
    room('r2', '主卧', 'bedroom', [[5, 0], [8, 0], [8, 3], [5, 3]], 0.88),
    room('r3', '厨房', 'kitchen', [[0, 3], [2.5, 3], [2.5, 7], [0, 7]], 0.82),
    room('r4', '卫生间', 'bathroom', [[2.5, 3], [5, 3], [5, 5], [2.5, 5]], 0.72),
    room('r5', '书房', 'study', [[2.5, 5], [5, 5], [5, 7], [2.5, 7]], 0.68),
  ],
  furniture: [
    furniture('f1', 'sofa', [2.5, 2.2], Math.PI, 'sage', 'r1'),
    furniture('f2', 'tv-console', [2.5, 0.35], 0, 'walnut', 'r1'),
    furniture('f3', 'coffee-table', [2.5, 1.35], 0, 'oak', 'r1'),
    furniture('f4', 'rug', [2.5, 1.45], 0, 'sage', 'r1'),
    furniture('f5', 'plant', [0.65, 0.5], 0, 'sage', 'r1'),
    furniture('f6', 'bed-double', [6.4, 1.2], 0, 'walnut', 'r2'),
    furniture('f7', 'nightstand', [5.3, 0.45], 0, 'walnut', 'r2'),
    furniture('f8', 'wardrobe', [7.65, 1.9], -Math.PI / 2, 'oak', 'r2'),
    furniture('f9', 'kitchen-cabinet', [1.45, 6.6], Math.PI, 'oak', 'r3'),
    furniture('f10', 'stove', [0.35, 6.6], Math.PI, 'walnut', 'r3'),
    furniture('f11', 'fridge', [2.1, 3.5], 0, 'sage', 'r3'),
    furniture('f12', 'toilet', [3.2, 4.5], Math.PI, 'walnut', 'r4'),
    furniture('f13', 'vanity', [4.6, 3.6], -Math.PI / 2, 'oak', 'r4'),
    furniture('f14', 'shower', [3.0, 3.55], 0, 'walnut', 'r4'),
    furniture('f15', 'desk', [3.75, 6.6], Math.PI, 'walnut', 'r5'),
    furniture('f16', 'dining-chair', [3.75, 5.95], 0, 'oak', 'r5'),
    furniture('f17', 'bookshelf', [4.65, 5.8], -Math.PI / 2, 'sage', 'r5'),
  ],
};

export interface DemoEntry {
  id: string;
  title: string;
  subtitle: string;
  area: number;
  plan: FloorPlan;
}

export const DEMO_PLANS: DemoEntry[] = [
  { id: 'one-bed', title: '暖阳一居', subtitle: '42㎡ · 一室一厅', area: 42, plan: oneBed },
  { id: 'two-bed', title: '双卧家庭', subtitle: '69㎡ · 两室两厅', area: 69, plan: twoBed },
  { id: 'three-bed', title: '三室朝阳', subtitle: '101㎡ · 三室两厅', area: 101, plan: threeBed },
  { id: 'l-shape', title: '折线手枪户型', subtitle: '44㎡ · 异形空间', area: 44, plan: lShape },
];

export function getDemoPlan(id: string): FloorPlan {
  const entry = DEMO_PLANS.find((item) => item.id === id) ?? DEMO_PLANS[1];
  return structuredClone(entry.plan);
}
