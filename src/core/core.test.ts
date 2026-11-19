import { describe, expect, it } from 'vitest';
import { DEMO_PLANS, getDemoPlan } from '../data/demos';
import { validateFurniture } from './placement';
import { emptyPlan, normalizeFloorPlan, planArea, scalePlan } from './schema';
import { PlanStore } from './store';

describe('示例户型数据', () => {
  it('提供 4 套示例且结构完整', () => {
    expect(DEMO_PLANS.length).toBeGreaterThanOrEqual(3);
    for (const demo of DEMO_PLANS) {
      const plan = getDemoPlan(demo.id);
      expect(plan.walls.length).toBeGreaterThan(0);
      expect(plan.rooms.length).toBeGreaterThan(0);
      expect(plan.furniture.length).toBeGreaterThan(0);
      expect(planArea(plan)).toBeGreaterThan(10);
    }
  });

  it('所有预置家具都通过碰撞与房间校验', () => {
    const failures: string[] = [];
    for (const demo of DEMO_PLANS) {
      const plan = getDemoPlan(demo.id);
      for (const item of plan.furniture) {
        const result = validateFurniture(plan, item.model, item.position, item.rotation, item.id);
        if (!result.valid) failures.push(`${demo.id} / ${item.id} / ${item.model}: ${result.reason ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('示例克隆互不影响', () => {
    const a = getDemoPlan('two-bed');
    const b = getDemoPlan('two-bed');
    a.furniture.pop();
    expect(b.furniture.length).toBeGreaterThan(a.furniture.length);
  });
});

describe('AI 输出容错解析', () => {
  it('解析合法 JSON 并保留房间与家具空列表', () => {
    const plan = normalizeFloorPlan({
      walls: [{ id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.24 }, { id: 'w2', start: [4, 0], end: [4, 3], thickness: 0.24 }, { id: 'w3', start: [4, 3], end: [0, 3], thickness: 0.24 }, { id: 'w4', start: [0, 3], end: [0, 0], thickness: 0.24 }],
      openings: [{ id: 'o1', wallId: 'w1', type: 'door', offset: 1, width: 0.9, height: 2.1, sillHeight: 0 }],
      rooms: [{ id: 'r1', name: '客厅', type: 'living', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], confidence: 0.9 }],
      furniture: [],
    }, '测试户型');
    expect(plan.name).toBe('测试户型');
    expect(plan.rooms).toHaveLength(1);
    expect(plan.openings).toHaveLength(1);
    expect(plan.furniture).toEqual([]);
  });

  it('只有房间时自动补墙', () => {
    const plan = normalizeFloorPlan({ rooms: [{ name: '卧室', type: 'bedroom', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }] });
    expect(plan.walls.length).toBeGreaterThanOrEqual(4);
  });

  it('完全无效输入抛出可读错误', () => {
    expect(() => normalizeFloorPlan({ foo: 1 })).toThrowError();
    expect(() => normalizeFloorPlan(null)).toThrowError();
  });
});

describe('尺寸校准', () => {
  it('等比缩放结构但保持家具物理尺寸与墙高', () => {
    const plan = getDemoPlan('one-bed');
    const before = planArea(plan);
    const bed = plan.furniture.find((item) => item.model === 'bed-double')!;
    const scaled = scalePlan(plan, 1.2, 'user-calibrated', before * 1.44);
    expect(planArea(scaled)).toBeCloseTo(before * 1.44, 0);
    expect(scaled.wallHeight).toBe(plan.wallHeight);
    const scaledBed = scaled.furniture.find((item) => item.id === bed.id)!;
    expect(scaledBed.model).toBe(bed.model);
    expect(scaled.scaleSource).toBe('user-calibrated');
    expect(scaled.totalAreaHint).toBeCloseTo(before * 1.44, 1);
  });
});

describe('状态存储', () => {
  it('撤销 / 重做恢复家具数量', () => {
    const store = new PlanStore(getDemoPlan('one-bed'));
    const count = store.plan.furniture.length;
    store.mutate((plan) => { plan.furniture.pop(); });
    expect(store.plan.furniture.length).toBe(count - 1);
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.plan.furniture.length).toBe(count);
    store.redo();
    expect(store.plan.furniture.length).toBe(count - 1);
  });

  it('普通 mutate 保留当前选择', () => {
    const store = new PlanStore(getDemoPlan('one-bed'));
    const id = store.plan.furniture[0].id;
    store.select({ furnitureId: id });
    store.mutate((plan) => { plan.furniture[0].rotation = 1; });
    expect(store.selection.furnitureId).toBe(id);
  });

  it('事务只记录一次历史', () => {
    const store = new PlanStore(emptyPlan('测试'));
    store.beginTransaction();
    store.mutate((plan) => { plan.wallHeight = 3; }, false);
    store.mutate((plan) => { plan.wallHeight = 3.2; }, false);
    store.endTransaction();
    store.undo();
    expect(store.plan.wallHeight).toBe(2.8);
  });
});
