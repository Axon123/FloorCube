import type { FloorPlan, FurnitureItem } from './schema';

export interface Selection {
  furnitureId?: string;
  roomId?: string;
  wallId?: string;
  openingId?: string;
}

export interface StoreEvent {
  type: 'plan' | 'furniture' | 'selection' | 'history';
  furnitureId?: string;
}

type Listener = (event: StoreEvent) => void;

function clonePlan(plan: FloorPlan): FloorPlan {
  return structuredClone(plan);
}

export class PlanStore {
  private current: FloorPlan;
  private past: FloorPlan[] = [];
  private future: FloorPlan[] = [];
  private transaction: FloorPlan | null = null;
  private listeners = new Set<Listener>();
  selection: Selection = {};

  constructor(plan: FloorPlan) {
    this.current = clonePlan(plan);
  }

  get plan() {
    return this.current;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: StoreEvent) {
    for (const listener of this.listeners) listener(event);
  }

  replace(plan: FloorPlan, record = true) {
    if (record) {
      this.past.push(clonePlan(this.current));
      if (this.past.length > 80) this.past.shift();
      this.future = [];
    }
    this.current = clonePlan(plan);
    this.selection = {};
    this.emit({ type: 'plan' });
    this.emit({ type: 'history' });
  }

  mutate(mutator: (plan: FloorPlan) => void, record = true) {
    const next = clonePlan(this.current);
    mutator(next);
    if (record) {
      this.past.push(clonePlan(this.current));
      if (this.past.length > 80) this.past.shift();
      this.future = [];
    }
    this.current = next;
    this.emit({ type: 'plan' });
    if (record) this.emit({ type: 'history' });
  }

  beginTransaction() {
    this.transaction = clonePlan(this.current);
  }

  endTransaction() {
    if (!this.transaction) return;
    if (JSON.stringify(this.transaction) !== JSON.stringify(this.current)) {
      this.past.push(this.transaction);
      if (this.past.length > 80) this.past.shift();
      this.future = [];
      this.emit({ type: 'history' });
    }
    this.transaction = null;
  }

  patchFurniture(id: string, patch: Partial<FurnitureItem>, record = false) {
    const item = this.current.furniture.find((candidate) => candidate.id === id);
    if (!item) return;
    Object.assign(item, patch);
    if (record) {
      this.past.push(clonePlan(this.current));
      this.future = [];
      this.emit({ type: 'history' });
    }
    this.emit({ type: 'furniture', furnitureId: id });
  }

  select(selection: Selection) {
    this.selection = selection;
    this.emit({ type: 'selection' });
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(clonePlan(this.current));
    this.current = previous;
    this.selection = {};
    this.emit({ type: 'plan' });
    this.emit({ type: 'history' });
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(clonePlan(this.current));
    this.current = next;
    this.selection = {};
    this.emit({ type: 'plan' });
    this.emit({ type: 'history' });
  }
}
