import { planBounds, polygonArea, polygonCentroid } from '../core/geometry';
import { allPlanPoints, planArea, roomColor, wallLength } from '../core/schema';
import type { FloorPlan } from '../core/schema';

function hex(color: number) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function planToSvg(plan: FloorPlan, width = 720): string {
  const bounds = planBounds(allPlanPoints(plan));
  const padding = 56;
  const scale = (width - padding * 2) / Math.max(bounds.width, 1);
  const height = Math.round(bounds.depth * scale + padding * 2 + 28);
  const x = (value: number) => padding + (value - bounds.minX) * scale;
  const y = (value: number) => padding + (value - bounds.minY) * scale;

  const rooms = plan.rooms.map((room) => {
    const points = room.polygon.map(([px, py]) => `${x(px)},${y(py)}`).join(' ');
    const [cx, cy] = polygonCentroid(room.polygon);
    const area = polygonArea(room.polygon).toFixed(1);
    return `
      <polygon points="${points}" fill="${hex(roomColor(room.type))}" fill-opacity="0.55" stroke="#8d887c" stroke-width="1"/>
      <text x="${x(cx)}" y="${y(cy) - 4}" text-anchor="middle" font-size="13" font-weight="600" fill="#3c423b">${escapeText(room.name)}</text>
      <text x="${x(cx)}" y="${y(cy) + 13}" text-anchor="middle" font-size="10" fill="#767b70">${area}㎡</text>
    `;
  }).join('');

  const walls = plan.walls.map((wall) => `
    <line x1="${x(wall.start[0])}" y1="${y(wall.start[1])}" x2="${x(wall.end[0])}" y2="${y(wall.end[1])}" stroke="#3f463f" stroke-width="${Math.max(3, wall.thickness * scale)}" stroke-linecap="square"/>
  `).join('');

  const openings = plan.openings.map((item) => {
    const wall = plan.walls.find((candidate) => candidate.id === item.wallId);
    if (!wall) return '';
    const length = wallLength(wall) || 1;
    const dx = (wall.end[0] - wall.start[0]) / length;
    const dy = (wall.end[1] - wall.start[1]) / length;
    const sx = wall.start[0] + dx * item.offset;
    const sy = wall.start[1] + dy * item.offset;
    const ex = sx + dx * item.width;
    const ey = sy + dy * item.width;
    if (item.type === 'window') {
      return `<line x1="${x(sx)}" y1="${y(sy)}" x2="${x(ex)}" y2="${y(ey)}" stroke="#6fa7b5" stroke-width="${Math.max(3, wall.thickness * scale)}"/><line x1="${x(sx)}" y1="${y(sy)}" x2="${x(ex)}" y2="${y(ey)}" stroke="#eaf4f5" stroke-width="1.5"/>`;
    }
    const hingeX = x(sx);
    const hingeY = y(sy);
    const radius = item.width * scale;
    return `
      <line x1="${x(sx)}" y1="${y(sy)}" x2="${x(ex)}" y2="${y(ey)}" stroke="#f6f2e9" stroke-width="${Math.max(4, wall.thickness * scale + 2)}"/>
      <path d="M ${x(ex)} ${y(ey)} A ${radius} ${radius} 0 0 1 ${hingeX + dy * radius} ${hingeY - dx * radius}" fill="none" stroke="#b08a5e" stroke-width="1.2" stroke-dasharray="3 2"/>
      <line x1="${hingeX}" y1="${hingeY}" x2="${hingeX + dy * radius}" y2="${hingeY - dx * radius}" stroke="#b08a5e" stroke-width="2"/>
    `;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="PingFang SC, Microsoft YaHei, sans-serif">
      <rect width="${width}" height="${height}" fill="#f8f5ee"/>
      <text x="${padding}" y="28" font-size="15" font-weight="700" fill="#30372f">${escapeText(plan.name)}</text>
      <text x="${width - padding}" y="28" text-anchor="end" font-size="11" fill="#8a8e82">约 ${planArea(plan).toFixed(0)}㎡ · 单位 m</text>
      ${rooms}
      ${walls}
      ${openings}
      <text x="${x(bounds.minX + bounds.width / 2)}" y="${height - 16}" text-anchor="middle" font-size="10" fill="#8a8e82">${bounds.width.toFixed(2)} m</text>
      <text x="18" y="${y(bounds.minY + bounds.depth / 2)}" text-anchor="middle" font-size="10" fill="#8a8e82" transform="rotate(-90 18 ${y(bounds.minY + bounds.depth / 2)})">${bounds.depth.toFixed(2)} m</text>
    </svg>
  `.trim();
}

export function planToDataUrl(plan: FloorPlan, width = 720) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(planToSvg(plan, width))}`;
}
