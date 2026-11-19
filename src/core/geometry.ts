export type Vec2 = [number, number];

export function polygonArea(polygon: Vec2[]) {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function polygonCentroid(polygon: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const count = polygon.length || 1;
    return [polygon.reduce((sum, point) => sum + point[0], 0) / count, polygon.reduce((sum, point) => sum + point[1], 0) / count];
  }
  return [x / (3 * area), y / (3 * area)];
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

export function segmentProjection(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy || 1;
  return Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
}

export function planBounds(points: Vec2[]) {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, depth: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY };
}

export function rotatePoint(center: Vec2, local: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [center[0] + local[0] * cos + local[1] * sin, center[1] - local[0] * sin + local[1] * cos];
}

export function rectangleCorners(center: Vec2, width: number, depth: number, rotation: number): Vec2[] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    rotatePoint(center, [-halfWidth, -halfDepth], rotation),
    rotatePoint(center, [halfWidth, -halfDepth], rotation),
    rotatePoint(center, [halfWidth, halfDepth], rotation),
    rotatePoint(center, [-halfWidth, halfDepth], rotation),
  ];
}

export function polygonsIntersect(a: Vec2[], b: Vec2[]) {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const [x1, y1] = polygon[index];
      const [x2, y2] = polygon[(index + 1) % polygon.length];
      const axis: Vec2 = [-(y2 - y1), x2 - x1];
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
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export function snap(value: number, step = 0.1) {
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
