import { distanceToSegment, planBounds, pointInPolygon, polygonArea, polygonCentroid, segmentProjection, snap } from '../core/geometry';
import type { Vec2 } from '../core/geometry';
import { furnitureCorners, validateFurniture } from '../core/placement';
import { allPlanPoints, roomColor, uid, wallLength } from '../core/schema';
import type { Opening, Room, Wall } from '../core/schema';
import type { PlanStore } from '../core/store';
import { getFurnitureDefinition } from '../models/catalog';
import { FURNITURE_PALETTES } from '../models/palette';

export type EditorTool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'erase';

export interface EditorCallbacks {
  onSelectRoom: (id: string | null) => void;
  onSelectFurniture: (id: string | null) => void;
  onFeedback: (message: string, kind?: 'info' | 'success' | 'warning') => void;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'endpoint'; wallId: string; index: 0 | 1 }
  | { kind: 'wall'; wallId: string; start: Vec2; originalStart: Vec2; originalEnd: Vec2 }
  | { kind: 'opening'; openingId: string; wallId: string }
  | { kind: 'vertex'; roomId: string; index: number }
  | { kind: 'furniture'; id: string; offset: Vec2; start: Vec2; rotation: number }
  | { kind: 'draw-wall'; start: Vec2; current: Vec2 }
  | { kind: 'draw-room'; start: Vec2; current: Vec2 };

function hex(color: number, alpha = 1) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class PlanEditor {
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private scale = 48;
  private origin: Vec2 = [40, 40];
  private tool: EditorTool = 'select';
  private snapEnabled = true;
  private showDimensions = false;
  private drag: DragState | null = null;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private hover: Vec2 | null = null;

  constructor(private container: HTMLElement, private store: PlanStore, private callbacks: EditorCallbacks) {
    this.canvas.className = 'plan-canvas';
    this.container.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.unsubscribe = this.store.subscribe(() => this.draw());
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.resize();
    this.fit();
  }

  setTool(tool: EditorTool) {
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.draw();
  }

  setOptions(options: { snapEnabled?: boolean; showDimensions?: boolean }) {
    if (options.snapEnabled !== undefined) this.snapEnabled = options.snapEnabled;
    if (options.showDimensions !== undefined) this.showDimensions = options.showDimensions;
    this.draw();
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.max(1, Math.floor(width * ratio));
    this.canvas.height = Math.max(1, Math.floor(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  fit() {
    const { width, height } = this.container.getBoundingClientRect();
    const bounds = planBounds(allPlanPoints(this.store.plan));
    const padding = 64;
    this.scale = Math.max(12, Math.min(140, Math.min((width - padding) / Math.max(bounds.width, 1), (height - padding) / Math.max(bounds.depth, 1))));
    this.origin = [width / 2 - (bounds.minX + bounds.width / 2) * this.scale, height / 2 - (bounds.minY + bounds.depth / 2) * this.scale];
    this.draw();
  }

  private toScreen(point: Vec2): Vec2 {
    return [this.origin[0] + point[0] * this.scale, this.origin[1] + point[1] * this.scale];
  }

  private toPlan(screen: Vec2): Vec2 {
    return [(screen[0] - this.origin[0]) / this.scale, (screen[1] - this.origin[1]) / this.scale];
  }

  private eventPoint(event: PointerEvent | WheelEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private maybeSnap(point: Vec2): Vec2 {
    return this.snapEnabled ? [snap(point[0]), snap(point[1])] : point;
  }

  private threshold() {
    return 10 / this.scale;
  }

  private hitWall(point: Vec2): Wall | null {
    const threshold = this.threshold();
    return this.store.plan.walls.find((wall) => distanceToSegment(point, wall.start, wall.end) < wall.thickness / 2 + threshold) ?? null;
  }

  private hitEndpoint(point: Vec2): { wall: Wall; index: 0 | 1 } | null {
    const threshold = this.threshold();
    for (const wall of this.store.plan.walls) {
      if (Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1]) < threshold) return { wall, index: 0 };
      if (Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1]) < threshold) return { wall, index: 1 };
    }
    return null;
  }

  private hitOpening(point: Vec2): Opening | null {
    const threshold = this.threshold();
    for (const opening of this.store.plan.openings) {
      const wall = this.store.plan.walls.find((candidate) => candidate.id === opening.wallId);
      if (!wall) continue;
      const length = wallLength(wall) || 1;
      const t = segmentProjection(point, wall.start, wall.end) * length;
      if (t >= opening.offset - threshold && t <= opening.offset + opening.width + threshold && distanceToSegment(point, wall.start, wall.end) < wall.thickness / 2 + threshold) {
        return opening;
      }
    }
    return null;
  }

  private hitVertex(point: Vec2): { room: Room; index: number } | null {
    const threshold = this.threshold();
    for (const room of this.store.plan.rooms) {
      for (let index = 0; index < room.polygon.length; index += 1) {
        const vertex = room.polygon[index];
        if (Math.hypot(point[0] - vertex[0], point[1] - vertex[1]) < threshold) return { room, index };
      }
    }
    return null;
  }

  private hitFurniture(point: Vec2) {
    return this.store.plan.furniture.find((item) => pointInPolygon(point, furnitureCorners(item))) ?? null;
  }

  private hitRoom(point: Vec2) {
    return this.store.plan.rooms.find((room) => pointInPolygon(point, room.polygon)) ?? null;
  }

  private onPointerDown = (event: PointerEvent) => {
    const screen = this.eventPoint(event);
    const point = this.toPlan(screen);
    this.canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || event.button === 2) {
      this.drag = { kind: 'pan', startX: screen[0], startY: screen[1], originX: this.origin[0], originY: this.origin[1] };
      return;
    }
    if (this.tool === 'wall') {
      const start = this.maybeSnap(point);
      this.drag = { kind: 'draw-wall', start, current: start };
      return;
    }
    if (this.tool === 'room') {
      const start = this.maybeSnap(point);
      this.drag = { kind: 'draw-room', start, current: start };
      return;
    }
    if (this.tool === 'door' || this.tool === 'window') {
      const wall = this.hitWall(point);
      if (!wall) {
        this.callbacks.onFeedback('请点击一面墙来放置门窗', 'warning');
        return;
      }
      const length = wallLength(wall);
      const width = this.tool === 'door' ? 0.9 : 1.2;
      const offset = Math.max(0, Math.min(length - width, segmentProjection(point, wall.start, wall.end) * length - width / 2));
      this.store.mutate((plan) => {
        plan.openings.push({ id: uid('o'), wallId: wall.id, type: this.tool === 'door' ? 'door' : 'window', offset, width, height: this.tool === 'door' ? 2.1 : 1.3, sillHeight: this.tool === 'door' ? 0 : 0.9 });
      });
      this.callbacks.onFeedback(this.tool === 'door' ? '已添加门' : '已添加窗', 'success');
      return;
    }
    if (this.tool === 'erase') {
      this.eraseAt(point);
      return;
    }

    const endpoint = this.hitEndpoint(point);
    if (endpoint) {
      this.store.beginTransaction();
      this.drag = { kind: 'endpoint', wallId: endpoint.wall.id, index: endpoint.index };
      return;
    }
    const opening = this.hitOpening(point);
    if (opening) {
      this.store.beginTransaction();
      this.drag = { kind: 'opening', openingId: opening.id, wallId: opening.wallId };
      return;
    }
    const vertex = this.hitVertex(point);
    if (vertex) {
      this.store.beginTransaction();
      this.drag = { kind: 'vertex', roomId: vertex.room.id, index: vertex.index };
      this.callbacks.onSelectRoom(vertex.room.id);
      return;
    }
    const furniture = this.hitFurniture(point);
    if (furniture) {
      this.store.beginTransaction();
      this.drag = { kind: 'furniture', id: furniture.id, offset: [furniture.position[0] - point[0], furniture.position[1] - point[1]], start: [...furniture.position], rotation: furniture.rotation };
      this.callbacks.onSelectFurniture(furniture.id);
      return;
    }
    const wall = this.hitWall(point);
    if (wall) {
      this.store.beginTransaction();
      this.drag = { kind: 'wall', wallId: wall.id, start: point, originalStart: [...wall.start], originalEnd: [...wall.end] };
      return;
    }
    const room = this.hitRoom(point);
    this.callbacks.onSelectRoom(room?.id ?? null);
    if (!room) this.callbacks.onSelectFurniture(null);
    this.drag = { kind: 'pan', startX: screen[0], startY: screen[1], originX: this.origin[0], originY: this.origin[1] };
  };

  private onPointerMove = (event: PointerEvent) => {
    const screen = this.eventPoint(event);
    const point = this.toPlan(screen);
    this.hover = point;
    if (!this.drag) {
      this.draw();
      return;
    }
    const drag = this.drag;
    if (drag.kind === 'pan') {
      this.origin = [drag.originX + screen[0] - drag.startX, drag.originY + screen[1] - drag.startY];
    } else if (drag.kind === 'draw-wall' || drag.kind === 'draw-room') {
      let current = this.maybeSnap(point);
      if (event.shiftKey && drag.kind === 'draw-wall') {
        const dx = Math.abs(current[0] - drag.start[0]);
        const dy = Math.abs(current[1] - drag.start[1]);
        current = dx > dy ? [current[0], drag.start[1]] : [drag.start[0], current[1]];
      }
      drag.current = current;
    } else if (drag.kind === 'endpoint') {
      let next = this.maybeSnap(point);
      const wall = this.store.plan.walls.find((candidate) => candidate.id === drag.wallId);
      if (wall && event.shiftKey) {
        const other = drag.index === 0 ? wall.end : wall.start;
        const dx = Math.abs(next[0] - other[0]);
        const dy = Math.abs(next[1] - other[1]);
        next = dx > dy ? [next[0], other[1]] : [other[0], next[1]];
      }
      this.store.mutate((plan) => {
        const target = plan.walls.find((candidate) => candidate.id === drag.wallId);
        if (target) target[drag.index === 0 ? 'start' : 'end'] = next;
      }, false);
    } else if (drag.kind === 'wall') {
      const delta: Vec2 = this.snapEnabled ? [snap(point[0] - drag.start[0]), snap(point[1] - drag.start[1])] : [point[0] - drag.start[0], point[1] - drag.start[1]];
      this.store.mutate((plan) => {
        const target = plan.walls.find((candidate) => candidate.id === drag.wallId);
        if (target) {
          target.start = [drag.originalStart[0] + delta[0], drag.originalStart[1] + delta[1]];
          target.end = [drag.originalEnd[0] + delta[0], drag.originalEnd[1] + delta[1]];
        }
      }, false);
    } else if (drag.kind === 'opening') {
      const wall = this.store.plan.walls.find((candidate) => candidate.id === drag.wallId);
      const opening = this.store.plan.openings.find((candidate) => candidate.id === drag.openingId);
      if (wall && opening) {
        const length = wallLength(wall);
        const offset = Math.max(0, Math.min(length - opening.width, segmentProjection(point, wall.start, wall.end) * length - opening.width / 2));
        this.store.mutate((plan) => {
          const target = plan.openings.find((candidate) => candidate.id === drag.openingId);
          if (target) target.offset = this.snapEnabled ? snap(offset) : offset;
        }, false);
      }
    } else if (drag.kind === 'vertex') {
      const next = this.maybeSnap(point);
      this.store.mutate((plan) => {
        const room = plan.rooms.find((candidate) => candidate.id === drag.roomId);
        if (room) room.polygon[drag.index] = next;
      }, false);
    } else if (drag.kind === 'furniture') {
      const position = this.maybeSnap([point[0] + drag.offset[0], point[1] + drag.offset[1]]);
      const result = validateFurniture(this.store.plan, this.store.plan.furniture.find((item) => item.id === drag.id)!.model, position, drag.rotation, drag.id);
      if (result.valid) {
        this.store.patchFurniture(drag.id, { position, roomId: result.roomId });
      }
    }
    this.draw();
  };

  private onPointerUp = () => {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    if (drag.kind === 'draw-wall') {
      if (wallLength({ id: '', start: drag.start, end: drag.current, thickness: 0 }) > 0.2) {
        this.store.mutate((plan) => {
          plan.walls.push({ id: uid('w'), start: drag.start, end: drag.current, thickness: 0.24, confidence: 1 });
        });
        this.callbacks.onFeedback('已添加墙体', 'success');
      }
    } else if (drag.kind === 'draw-room') {
      const [x1, y1] = drag.start;
      const [x2, y2] = drag.current;
      if (Math.abs(x2 - x1) > 0.5 && Math.abs(y2 - y1) > 0.5) {
        const polygon: Vec2[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
        this.store.mutate((plan) => {
          const roomId = uid('r');
          plan.rooms.push({ id: roomId, name: '新房间', type: 'other', polygon, confidence: 1 });
          for (let index = 0; index < polygon.length; index += 1) {
            const start = polygon[index];
            const end = polygon[(index + 1) % polygon.length];
            const exists = plan.walls.some((wall) => distanceToSegment(start, wall.start, wall.end) < 0.05 && distanceToSegment(end, wall.start, wall.end) < 0.05);
            if (!exists) plan.walls.push({ id: uid('w'), start: [...start], end: [...end], thickness: 0.24, confidence: 1 });
          }
        });
        this.callbacks.onFeedback('已添加房间与墙体', 'success');
      }
    } else if (drag.kind !== 'pan') {
      this.store.endTransaction();
    }
    this.draw();
  };

  private onPointerLeave = () => {
    this.hover = null;
    this.draw();
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const screen = this.eventPoint(event);
    const before = this.toPlan(screen);
    this.scale = Math.max(12, Math.min(180, this.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
    this.origin = [screen[0] - before[0] * this.scale, screen[1] - before[1] * this.scale];
    this.draw();
  };

  private eraseAt(point: Vec2) {
    const opening = this.hitOpening(point);
    if (opening) {
      this.store.mutate((plan) => { plan.openings = plan.openings.filter((item) => item.id !== opening.id); });
      this.callbacks.onFeedback('已删除门窗', 'success');
      return;
    }
    const furniture = this.hitFurniture(point);
    if (furniture) {
      this.store.mutate((plan) => { plan.furniture = plan.furniture.filter((item) => item.id !== furniture.id); });
      this.callbacks.onFeedback('已删除家具', 'success');
      return;
    }
    const wall = this.hitWall(point);
    if (wall) {
      this.store.mutate((plan) => {
        plan.walls = plan.walls.filter((item) => item.id !== wall.id);
        plan.openings = plan.openings.filter((item) => item.wallId !== wall.id);
      });
      this.callbacks.onFeedback('已删除墙体', 'success');
      return;
    }
    const room = this.hitRoom(point);
    if (room) {
      this.store.mutate((plan) => {
        plan.rooms = plan.rooms.filter((item) => item.id !== room.id);
        plan.furniture = plan.furniture.filter((item) => item.roomId !== room.id);
      });
      this.callbacks.onFeedback('已删除房间', 'success');
    }
  }

  private draw() {
    const { width, height } = this.container.getBoundingClientRect();
    const context = this.context;
    const plan = this.store.plan;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#f6f2e8';
    context.fillRect(0, 0, width, height);

    const gridStep = this.scale > 36 ? 0.5 : 1;
    context.strokeStyle = 'rgba(120,112,94,0.12)';
    context.lineWidth = 1;
    const bounds = planBounds(allPlanPoints(plan));
    const startX = Math.floor(bounds.minX - 2);
    const endX = Math.ceil(bounds.maxX + 2);
    const startY = Math.floor(bounds.minY - 2);
    const endY = Math.ceil(bounds.maxY + 2);
    context.beginPath();
    for (let x = startX; x <= endX; x += gridStep) {
      const [sx] = this.toScreen([x, 0]);
      context.moveTo(sx, 0);
      context.lineTo(sx, height);
    }
    for (let y = startY; y <= endY; y += gridStep) {
      const [, sy] = this.toScreen([0, y]);
      context.moveTo(0, sy);
      context.lineTo(width, sy);
    }
    context.stroke();

    for (const room of plan.rooms) {
      context.beginPath();
      room.polygon.forEach((point, index) => {
        const [x, y] = this.toScreen(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.fillStyle = hex(roomColor(room.type), 0.5);
      context.fill();
      if (room.confidence < 0.8) {
        context.setLineDash([6, 4]);
        context.strokeStyle = '#d9822b';
        context.lineWidth = 2;
        context.stroke();
        context.setLineDash([]);
      }
      const [cx, cy] = this.toScreen(polygonCentroid(room.polygon));
      context.fillStyle = '#39413a';
      context.font = '600 12px PingFang SC, sans-serif';
      context.textAlign = 'center';
      context.fillText(room.name, cx, cy - 2);
      context.fillStyle = '#7b8074';
      context.font = '10px PingFang SC, sans-serif';
      context.fillText(`${polygonArea(room.polygon).toFixed(1)}㎡${room.confidence < 0.8 ? ' · 建议检查' : ''}`, cx, cy + 12);
      if (this.store.selection.roomId === room.id) {
        context.strokeStyle = '#4f7d63';
        context.lineWidth = 2;
        context.stroke();
        for (const point of room.polygon) {
          const [x, y] = this.toScreen(point);
          context.fillStyle = '#4f7d63';
          context.fillRect(x - 3, y - 3, 6, 6);
        }
      }
    }

    for (const item of plan.furniture) {
      const corners = furnitureCorners(item).map((point) => this.toScreen(point));
      const definition = getFurnitureDefinition(item.model);
      const palette = FURNITURE_PALETTES[item.color];
      context.beginPath();
      corners.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
      context.closePath();
      context.fillStyle = hex(palette.wood, item.model === 'rug' ? 0.28 : 0.55);
      context.fill();
      context.strokeStyle = this.store.selection.furnitureId === item.id ? '#d9822b' : 'rgba(60,66,58,0.55)';
      context.lineWidth = this.store.selection.furnitureId === item.id ? 2 : 1;
      context.stroke();
      const [cx, cy] = this.toScreen(item.position);
      const front = this.toScreen([item.position[0] + Math.sin(item.rotation) * definition.dimensions.depth * 0.35, item.position[1] + Math.cos(item.rotation) * definition.dimensions.depth * 0.35]);
      context.beginPath();
      context.moveTo(cx, cy);
      context.lineTo(front[0], front[1]);
      context.strokeStyle = 'rgba(60,66,58,0.7)';
      context.stroke();
    }

    for (const wall of plan.walls) {
      const [x1, y1] = this.toScreen(wall.start);
      const [x2, y2] = this.toScreen(wall.end);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.strokeStyle = this.store.selection.wallId === wall.id ? '#4f7d63' : '#3f463f';
      context.lineWidth = Math.max(3, wall.thickness * this.scale);
      context.lineCap = 'square';
      context.stroke();
      if (this.showDimensions) {
        context.fillStyle = '#6f7568';
        context.font = '10px PingFang SC, sans-serif';
        context.textAlign = 'center';
        context.fillText(`${wallLength(wall).toFixed(2)}m`, (x1 + x2) / 2, (y1 + y2) / 2 - 8);
      }
    }

    for (const opening of plan.openings) {
      const wall = plan.walls.find((candidate) => candidate.id === opening.wallId);
      if (!wall) continue;
      const length = wallLength(wall) || 1;
      const dx = (wall.end[0] - wall.start[0]) / length;
      const dy = (wall.end[1] - wall.start[1]) / length;
      const start: Vec2 = [wall.start[0] + dx * opening.offset, wall.start[1] + dy * opening.offset];
      const end: Vec2 = [start[0] + dx * opening.width, start[1] + dy * opening.width];
      const [sx, sy] = this.toScreen(start);
      const [ex, ey] = this.toScreen(end);
      context.beginPath();
      context.moveTo(sx, sy);
      context.lineTo(ex, ey);
      context.strokeStyle = '#f6f2e8';
      context.lineWidth = Math.max(4, wall.thickness * this.scale + 2);
      context.stroke();
      if (opening.type === 'window') {
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(ex, ey);
        context.strokeStyle = '#5f97a6';
        context.lineWidth = 3;
        context.stroke();
      } else {
        const radius = opening.width * this.scale;
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(sx + dy * radius, sy - dx * radius);
        context.strokeStyle = '#b08a5e';
        context.lineWidth = 2;
        context.stroke();
        context.beginPath();
        context.arc(sx, sy, radius, Math.atan2(ey - sy, ex - sx), Math.atan2(-dx, dy));
        context.strokeStyle = 'rgba(176,138,94,0.6)';
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.stroke();
        context.setLineDash([]);
      }
    }

    if (this.drag?.kind === 'draw-wall') {
      const [x1, y1] = this.toScreen(this.drag.start);
      const [x2, y2] = this.toScreen(this.drag.current);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.strokeStyle = '#4f7d63';
      context.lineWidth = Math.max(3, 0.24 * this.scale);
      context.stroke();
    }
    if (this.drag?.kind === 'draw-room') {
      const [x1, y1] = this.toScreen(this.drag.start);
      const [x2, y2] = this.toScreen(this.drag.current);
      context.fillStyle = 'rgba(79,125,99,0.18)';
      context.strokeStyle = '#4f7d63';
      context.lineWidth = 2;
      context.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      context.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    if (this.hover && this.tool !== 'select') {
      const [x, y] = this.toScreen(this.maybeSnap(this.hover));
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = '#d9822b';
      context.fill();
    }
  }

  dispose() {
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.remove();
  }
}
