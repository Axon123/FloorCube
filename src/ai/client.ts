import { normalizeFloorPlan } from '../core/schema';
import { polygonArea } from '../core/geometry';
import type { Vec2 } from '../core/geometry';
import type { FloorPlan, ModelConfig } from '../core/schema';
import { FURNITURE_CATALOG } from '../models/catalog';

export const MODEL_PRESETS = [
  { model: 'deepseek-flash', label: 'DeepSeek Flash' },
];

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const BASE_URL_PRESETS = [
  { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '阿里云百炼官方' },
  { baseUrl: DEEPSEEK_BASE_URL, label: 'DeepSeek 官方' },
];

export function isReasoningModel(config: ModelConfig) {
  return /deepseek/i.test(config.model) || /deepseek/i.test(config.baseUrl);
}

export const DEFAULT_BASE_URL = DEEPSEEK_BASE_URL;
export const DEFAULT_MODEL = 'deepseek-flash';
const BAILIAN_DEEPSEEK_MODEL = 'deepseek-v4.1-flash';

function isBailianHost(host: string) {
  return /^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(host) || host.endsWith('.maas.aliyuncs.com');
}

export function getRequestModel(config: Pick<ModelConfig, 'baseUrl' | 'model'>) {
  const host = new URL(config.baseUrl).hostname.toLowerCase();
  return isBailianHost(host) && config.model === DEFAULT_MODEL ? BAILIAN_DEEPSEEK_MODEL : config.model;
}

export interface RecognitionProgress {
  phase: 'connecting' | 'receiving' | 'validating';
  transport: 'direct' | 'proxy';
  receivedChars: number;
  partial: FloorPlan | null;
  buffered: boolean;
}

export type RecognitionMode = 'fast' | 'detailed';

export interface RecognitionOptions {
  mode?: RecognitionMode;
  signal?: AbortSignal;
  onProgress?: (progress: RecognitionProgress) => void;
}

interface RecognitionParameters {
  max_tokens: number;
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'high';
  enable_thinking?: boolean;
  thinking_budget?: number;
}

export function getRecognitionSettings(config: ModelConfig, mode: RecognitionMode): { parameters: RecognitionParameters; note: string } {
  const detailed = mode === 'detailed';
  const host = new URL(config.baseUrl).hostname.toLowerCase();
  const model = getRequestModel(config).toLowerCase();
  if (host === 'api.deepseek.com' && /^deepseek-(?:flash|v4-(?:flash|pro))(?:-\d{4})?$/.test(model)) {
    return {
      parameters: {
        max_tokens: detailed ? 32_768 : 8192,
        thinking: { type: detailed ? 'enabled' : 'disabled' },
        ...(detailed ? { reasoning_effort: 'high' as const } : {}),
      },
      note: detailed ? '将请求开启思考，重点核对尺寸、墙体连接与家具朝向；可能更慢、费用更高。'
        : '将请求关闭思考，适合清晰户型图；复杂或模糊细节可能需要手动校正。',
    };
  }
  const dashscope = isBailianHost(host);
  if (dashscope && model === BAILIAN_DEEPSEEK_MODEL) {
    return {
      parameters: {
        max_tokens: detailed ? 32_768 : 8192,
        enable_thinking: detailed,
        ...(detailed ? { reasoning_effort: 'high' as const } : {}),
      },
      note: detailed
        ? `百炼 ${BAILIAN_DEEPSEEK_MODEL}：将请求开启思考（high），核对尺寸与结构；可能更慢、费用更高。`
        : `百炼 ${BAILIAN_DEEPSEEK_MODEL}：将请求关闭思考，优先返回识别结果；复杂细节可能需要手动校正。`,
    };
  }
  const hybridQwen = /^qwen3-vl-plus(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
    || /^qwen3\.[5-8]-(?:plus|flash|max)(?:-(?:latest|\d{4}-\d{2}-\d{2}))?$/.test(model);
  if (dashscope && hybridQwen) {
    return {
      parameters: {
        max_tokens: detailed ? 32_768 : 8192,
        enable_thinking: detailed,
        ...(detailed ? { thinking_budget: 8192 } : {}),
      },
      note: detailed ? '将请求开启思考，最多使用 8192 个思考 token 核对细节；可能更慢、费用更高。'
        : '将请求关闭思考，优先返回户型结构；复杂或模糊细节可能需要手动校正。',
    };
  }
  return {
    parameters: { max_tokens: isReasoningModel(config) ? 32_768 : 8192 },
    note: '当前接口或模型未适配思考开关，仅调整识别侧重点，不保证提速或关闭思考。',
  };
}

const SYSTEM_PROMPT = '你是专业的建筑户型图识别引擎。你只输出一个合法 JSON 对象，不输出解释、Markdown 或代码块。所有坐标单位为米，x 向右、y 向下。墙体用中心线线段表示，房间用闭合多边形表示，门窗偏移量从墙体 start 沿 end 方向计算。';

const USER_PROMPT = `请识别这张户型图纸照片，输出结构化 JSON。要求：
1. 尽量读取图纸标注尺寸；若没有标注，按标准门宽约 0.9m 推算比例，scaleSource 填 "door-reference"，有标注填 "annotation"。
2. walls 覆盖外墙与内墙，thickness 常见 0.12~0.24；rooms 覆盖所有可识别房间，type 只能是 bedroom/living/kitchen/bathroom/balcony/dining/study/entry/other。
3. openings 的 wallId 必须引用 walls.id；door 高度约 2.1、sillHeight 0；window 高度约 1.2~1.5、sillHeight 约 0.9。
4. 对模糊、被遮挡或无法确认的墙和房间给较低 confidence（0~1），不要编造不存在的空间。
5. furniture 只输出图中明确画出且能辨认类别的家具，不根据房间用途凭空添加；没有清晰家具时输出 []。model 仅支持 ${FURNITURE_CATALOG.map((item) => item.id).join('/')}。数组元素格式为 {"id":"f1","model":"toilet","roomId":"r1","position":[1,1],"rotation":0,"color":"walnut"}；position 是家具中心点，roomId 必须引用 rooms.id，color 只能是 walnut/oak/sage。
6. rotation 使用弧度，优先取 0、1.5708、3.1416、-1.5708。所有家具正面均为模型局部 +z，在图纸平面中的正方向为 [sin(rotation),cos(rotation)]：0 朝 +y，1.5708 朝 +x，3.1416 朝 -y，-1.5708 朝 -x。先辨认家具自身前后特征，再换算 rotation，不要把图像上方直接当成家具背面。
7. 马桶水箱、床头、沙发靠背和柜体背面应靠近实墙，马桶座圈前方、床尾、沙发座位前方和柜门应朝房间内可用空间，不得朝向墙体或紧贴其他家具。前后特征模糊时，结合最近实墙和可用空间判断，不要按图纸上下方向臆测；类别或位置也不清晰时不要输出该家具。
8. 输出紧凑单行 JSON：不要换行与多余空格，不要 Markdown 代码块，不要任何解释文字。顶层数组必须依次输出 walls、rooms、openings、furniture，先完整输出墙体与房间，再输出门窗和家具，以便逐步展示结构。
9. 只输出如下 Schema 的 JSON：
{"version":1,"name":"户型名称","unit":"m","scaleSource":"annotation|door-reference","totalAreaHint":数字或省略,"wallHeight":2.8,"walls":[{"id":"w1","start":[0,0],"end":[4.2,0],"thickness":0.24,"confidence":0.9}],"rooms":[{"id":"r1","name":"主卧","type":"bedroom","polygon":[[0,0],[4.2,0],[4.2,3.6],[0,3.6]],"confidence":0.9}],"openings":[{"id":"o1","wallId":"w1","type":"door|window","offset":1.2,"width":0.9,"height":2.1,"sillHeight":0}],"furniture":[]}`;

function endpoint(config: ModelConfig) {
  return `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function tinyImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 8, 8);
  context.fillStyle = '#333333';
  context.fillRect(2, 2, 4, 4);
  return canvas.toDataURL('image/png');
}

function readableError(status: number, detail: string) {
  const lower = detail.toLowerCase();
  if (lower.includes('image') || lower.includes('vision') || lower.includes('multimodal') || lower.includes('image_url')) {
    return '该模型不接受图像输入，请选择 DeepSeek Flash 或服务商支持的其他视觉模型。';
  }
  if (status === 401 || status === 403) return 'API Key 无效或没有权限，请检查 Key 是否正确。';
  if (status === 404) return '接口地址或模型名称不存在，请检查 Base URL 与模型名。';
  if (status === 429) return '请求过于频繁或额度不足，请稍后重试或检查账户额度。';
  if (status === 400) return `请求被拒绝：${detail.slice(0, 160)}`;
  return `模型接口返回 ${status}：${detail.slice(0, 160)}`;
}

async function parseErrorResponse(response: Response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return json.error?.message ?? json.message ?? text;
  } catch {
    return text;
  }
}

export class RecognitionError extends Error {
  raw?: string;

  constructor(message: string, raw?: string) {
    super(message);
    this.name = 'RecognitionError';
    this.raw = raw;
  }
}

function stripTrailingCommas(text: string) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

function extractBalanced(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') inString = !inString;
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function completeTruncated(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let safeCut = -1;
  let safeStack: string[] = [];
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      stack.pop();
      safeCut = index + 1;
      safeStack = [...stack];
    } else if (character === ',' && stack.length > 0) {
      safeCut = index;
      safeStack = [...stack];
    }
  }
  if (safeCut < 0 || safeStack.length === 0) return null;
  const closers = safeStack.map((character) => (character === '{' ? '}' : ']')).reverse().join('');
  return stripTrailingCommas(text.slice(0, safeCut)) + closers;
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const balanced = extractBalanced(trimmed);
  if (balanced) candidates.push(balanced);
  for (const candidate of candidates) {
    try {
      return JSON.parse(stripTrailingCommas(candidate));
    } catch {
      // try next candidate
    }
  }
  for (const base of [trimmed, balanced ?? '']) {
    const repaired = completeTruncated(base);
    if (!repaired) continue;
    try {
      return JSON.parse(repaired);
    } catch {
      // try next base
    }
  }
  throw new RecognitionError('模型输出不是合法 JSON（可能被截断或夹带解释文字）。可查看原始输出排查，或手动重试。', content);
}

async function postChat(config: ModelConfig, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(payload),
    signal: controller.signal,
  };
  try {
    let response: Response;
    try {
      response = await fetch(endpoint(config), init);
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || !(error instanceof TypeError)) throw error;
      const proxyResponse = await fetch('/functions/v1/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: config.baseUrl, apiKey: config.apiKey, payload }),
        signal: controller.signal,
      });
      if (!proxyResponse.ok) {
        const detail = await parseErrorResponse(proxyResponse);
        throw new Error(`浏览器直连被 CORS 拦截，转发也失败：${detail.slice(0, 140)}`);
      }
      response = proxyResponse;
    }
    if (!response.ok) {
      throw new Error(readableError(response.status, await parseErrorResponse(response)));
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted || isAbort(error)) {
      throw new Error('请求超时，请检查网络或稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function messageContent(response: unknown): string {
  const data = response as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('');
  throw new Error('模型没有返回可解析的内容。');
}

export async function testConnection(config: ModelConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const reasoning = isReasoningModel(config);
    const response = await postChat(config, {
      model: getRequestModel(config),
      stream: false,
      ...getRecognitionSettings(config, 'fast').parameters,
      max_tokens: reasoning ? 1024 : 8,
      messages: [
        { role: 'system', content: 'Reply with OK only.' },
        { role: 'user', content: [{ type: 'text', text: '这是一张测试图片，请回复 OK。' }, { type: 'image_url', image_url: { url: tinyImage() } }] },
      ],
    }, reasoning ? 60_000 : 25_000);
    messageContent(response);
    return { ok: true, message: '连接成功，模型支持图像输入。' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '连接失败，请检查配置。' };
  }
}

const TOTAL_TIMEOUT_MS = 240_000;
const FIRST_BYTE_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 250;
const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_BUFFERED_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES = 2 * 1024 * 1024;
// SSE repeats metadata per token, so wire volume is not retained plan size.
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const ARRAY_KEYS = ['walls', 'rooms', 'openings', 'furniture'] as const;

type JsonRecord = Record<string, unknown>;
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Locate an already-closed JSON value, never manufacture a closing token.
function closedValueEnd(text: string, start: number): number {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  const composite = text[start] === '{' || text[start] === '[' || text[start] === '"';
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        quoted = false;
        if (stack.length === 0) return index + 1;
      }
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (!composite) return index;
      if (stack.pop() !== (char === '}' ? '{' : '[')) return -1;
      if (stack.length === 0) return index + 1;
    } else if (!composite && /[\s,]/.test(char)) return index;
  }
  return -1;
}

// Only scan root properties and complete elements of their arrays. Nested arrays,
// escaped quotes and braces inside strings cannot become phantom root entries.
function closedRootValues(text: string): JsonRecord {
  const result: JsonRecord = Object.create(null);
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor += 1; };
  whitespace();
  if (text[cursor++] !== '{') return result;
  try {
    while (cursor < text.length) {
      whitespace();
      if (text[cursor] !== '"') break;
      const keyEnd = closedValueEnd(text, cursor);
      if (keyEnd < 0) break;
      const key: string = JSON.parse(text.slice(cursor, keyEnd));
      cursor = keyEnd;
      whitespace();
      if (text[cursor++] !== ':') break;
      whitespace();
      if (ARRAY_KEYS.some((candidate) => candidate === key) && text[cursor] === '[') {
        // The first occurrence wins so duplicate keys cannot replace live IDs.
        const entries: unknown[] = [];
        if (!(key in result)) result[key] = entries;
        cursor += 1;
        while (cursor < text.length) {
          whitespace();
          if (text[cursor] === ']') break;
          const end = closedValueEnd(text, cursor);
          if (end < 0) return result;
          entries.push(JSON.parse(text.slice(cursor, end)));
          cursor = end;
          whitespace();
          if (text[cursor] !== ',') break;
          cursor += 1;
        }
        if (text[cursor++] !== ']') break;
      } else {
        const end = closedValueEnd(text, cursor);
        if (end < 0) break;
        if (!(key in result)) result[key] = JSON.parse(text.slice(cursor, end));
        cursor = end;
      }
      whitespace();
      if (text[cursor++] !== ',') break;
    }
  } catch {
    // A malformed or unfinished value never becomes a repaired preview object.
  }
  return result;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPoint(value: unknown): value is Vec2 {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => finite(coordinate) && Math.abs(coordinate) <= 1_000_000);
}

function partialPlan(content: string): FloorPlan | null {
  const raw = closedRootValues(content);
  const entries = (key: typeof ARRAY_KEYS[number]) => {
    const ids = new Set<string>();
    return (Array.isArray(raw[key]) ? raw[key] : []).filter((item): item is JsonRecord => {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return false;
      ids.add(item.id);
      return true;
    });
  };
  const confidence = (item: JsonRecord) => item.confidence === undefined || finite(item.confidence);
  const walls = entries('walls').filter((item) => validPoint(item.start) && validPoint(item.end)
    && Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]) >= 0.05
    && finite(item.thickness) && item.thickness > 0 && confidence(item));
  const rooms = entries('rooms').filter((item) => Array.isArray(item.polygon) && item.polygon.length >= 3
    && item.polygon.every(validPoint) && polygonArea(item.polygon) >= 0.5 && confidence(item));
  if (!walls.length && !rooms.length) return null;
  const wallIds = new Set(walls.map((item) => item.id));
  const roomIds = new Set(rooms.map((item) => item.id));
  const openings = entries('openings').filter((item) => wallIds.has(item.wallId)
    && (item.type === 'door' || item.type === 'window')
    && finite(item.offset) && item.offset >= 0 && finite(item.width) && item.width > 0
    && finite(item.height) && item.height > 0 && finite(item.sillHeight) && item.sillHeight >= 0);
  const furniture = entries('furniture').filter((item) => roomIds.has(item.roomId)
    && validPoint(item.position) && finite(item.rotation)
    && FURNITURE_CATALOG.some((model) => model.id === item.model));
  try {
    const plan = normalizeFloorPlan({
      name: raw.name, scaleSource: raw.scaleSource,
      wallHeight: finite(raw.wallHeight) ? raw.wallHeight : undefined,
      totalAreaHint: finite(raw.totalAreaHint) ? raw.totalAreaHint : undefined,
      walls, rooms, openings, furniture,
    }, 'AI 识别户型');
    // normalizeFloorPlan's compatibility fallbacks are useful for final imports,
    // but must NEVER appear as observations in a streaming preview.
    plan.walls = plan.walls.filter((item) => wallIds.has(item.id));
    plan.rooms = plan.rooms.filter((item) => roomIds.has(item.id));
    return plan;
  } catch {
    return null;
  }
}

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => isRecord(part)
    && (part.type === undefined || part.type === 'text' || part.type === 'output_text')
    && typeof part.text === 'string').map((part) => part.text).join('');
}

function providerError(data: unknown): string | null {
  if (!isRecord(data) || !data.error) return null;
  return isRecord(data.error) && typeof data.error.message === 'string'
    ? data.error.message.slice(0, 160) : '模型接口报告流式响应错误。';
}

// Incremental SSE framing, including CR, CRLF (even across reads), multiline
// data, comments and UTF-8 decoded by the caller's persistent TextDecoder.
function sseParser(onEvent: (data: string, event: string) => void) {
  let pending = '';
  let data: string[] = [];
  let event = '';
  let eventBytes = 0;
  const encoder = new TextEncoder();
  const checkSize = (bytes: number) => {
    if (bytes > MAX_SSE_EVENT_BYTES) throw new Error('单条流式事件超过 2MB 安全上限，已停止接收。');
  };
  const line = (value: string, delimiterBytes: number) => {
    eventBytes += encoder.encode(value).byteLength + delimiterBytes;
    checkSize(eventBytes);
    if (value === '') {
      if (data.length || event === 'error') onEvent(data.join('\n'), event);
      data = [];
      event = '';
      eventBytes = 0;
    } else if (!value.startsWith(':')) {
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let valuePart = colon < 0 ? '' : value.slice(colon + 1);
      if (valuePart.startsWith(' ')) valuePart = valuePart.slice(1);
      if (field === 'data') data.push(valuePart);
      if (field === 'event') event = valuePart;
    }
  };
  return (chunk: string, final = false) => {
    pending += chunk;
    let start = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const char = pending[index];
      if (char !== '\r' && char !== '\n') continue;
      if (char === '\r' && index === pending.length - 1 && !final) break;
      const delimiterBytes = char === '\r' && pending[index + 1] === '\n' ? 2 : 1;
      line(pending.slice(start, index), delimiterBytes);
      index += delimiterBytes - 1;
      start = index + 1;
    }
    pending = pending.slice(start);
    checkSize(eventBytes + encoder.encode(pending).byteLength);
    if (final && (data.length || event === 'error' || (pending && !pending.startsWith(':')))) {
      throw new Error('流式响应在事件结束前中断，请手动重试或使用已接收的部分结果。');
    }
  };
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

// The race also cancels a pending body read when a custom fetch implementation
// fails to reject on abort. Each temporary listener is removed on every outcome.
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function recognizeFloorPlan(
  config: ModelConfig,
  imageDataUrl: string,
  options: RecognitionOptions = {},
): Promise<FloorPlan> {
  if (options.signal?.aborted) throw new RecognitionError('识别已取消。', '');
  const controller = new AbortController();
  let interrupted = '';
  const stop = (message: string) => {
    if (controller.signal.aborted) return;
    interrupted = message;
    controller.abort();
  };
  const cancel = () => stop('识别已取消。');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const totalTimer = setTimeout(() => stop('识别总时长超过 240 秒，已超时。请手动重试或使用部分结果。'), TOTAL_TIMEOUT_MS);
  const firstByteTimer = setTimeout(() => stop('等待模型首个响应超过 90 秒，已超时。请检查网络或手动重试。'), FIRST_BYTE_TIMEOUT_MS);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let raw = '';
  let contentBytes = 0;
  const encoder = new TextEncoder();
  let transport: RecognitionProgress['transport'] = 'direct';
  let buffered = false;
  let lastProgress = -Infinity;
  const emit = (phase: RecognitionProgress['phase']) => {
    clearTimeout(progressTimer);
    progressTimer = undefined;
    if (phase === 'receiving') lastProgress = Date.now();
    options.onProgress?.({ phase, transport, receivedChars: raw.length, partial: raw ? partialPlan(raw) : null, buffered });
  };
  const append = (text: string) => {
    if (!text) return;
    contentBytes += encoder.encode(text).byteLength;
    if (contentBytes > MAX_CONTENT_BYTES) throw new Error('模型输出超过 1MB 安全上限，已停止接收。');
    raw += text;
    if (!options.onProgress) return;
    const delay = PROGRESS_INTERVAL_MS - (Date.now() - lastProgress);
    if (delay <= 0) emit('receiving');
    else if (progressTimer === undefined) progressTimer = setTimeout(() => emit('receiving'), delay);
  };
  let lengthLimited = false;
  let responseComplete = false;
  let done = false;
  let assistant = true;
  const consume = sseParser((text, event) => {
    if (done) return;
    if (event === 'error') {
      let detail = text;
      try {
        const data: unknown = JSON.parse(text);
        detail = providerError(data) ?? (isRecord(data) && typeof data.message === 'string' ? data.message : '流式接口错误');
      } catch { /* An SSE error may be plain text. */ }
      throw new Error(`模型流式响应失败：${detail.slice(0, 160)}`);
    }
    if (text.trim() === '[DONE]') { done = true; return; }
    if (!text.trim()) return;
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('模型返回了无法解析的流式事件。'); }
    const error = providerError(data);
    if (error) throw new Error(`模型流式响应失败：${error}`);
    if (!isRecord(data) || !Array.isArray(data.choices)) return;
    const choice = data.choices.find((item: unknown) => isRecord(item) && (item.index === 0 || item.index === undefined));
    if (!isRecord(choice)) return;
    if (isRecord(choice.delta)) {
      if (typeof choice.delta.role === 'string') assistant = choice.delta.role === 'assistant';
      if (assistant) append(assistantText(choice.delta.content));
    }
    if (choice.finish_reason === 'length') lengthLimited = true;
    if (choice.finish_reason === 'content_filter') throw new Error('模型停止了输出：内容被接口过滤。');
  });

  try {
    const recognitionMode = options.mode ?? 'fast';
    const modePrompt = recognitionMode === 'detailed'
      ? '识别模式：精细。输出前仔细核对墙体连通、尺寸比例、门窗引用和家具朝向；不要补造图中没有的信息，最终只输出上述 JSON。'
      : '识别模式：快速。优先输出图中明确的结构，不反复推敲模糊细节；不确定项降低置信度，仍须完整遵守上述 Schema 与家具识别要求。';
    const payload = {
      model: getRequestModel(config), stream: true, temperature: 0.1,
      ...getRecognitionSettings(config, recognitionMode).parameters,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: `${USER_PROMPT}\n${modePrompt}` }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
      ],
    };
    emit('connecting');
    controller.signal.throwIfAborted();
    let response: Response;
    try {
      response = await abortable(fetch(endpoint(config), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(payload), signal: controller.signal,
      }), controller.signal);
    } catch (error) {
      // Only a failed direct fetch (network/CORS), never HTTP/body/parser errors,
      // cancellation or a timeout, is allowed to use the existing proxy route.
      if (controller.signal.aborted || isAbort(error) || !(error instanceof TypeError)) throw error;
      transport = 'proxy';
      emit('connecting');
      controller.signal.throwIfAborted();
      response = await abortable(fetch('/functions/v1/app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: config.baseUrl, apiKey: config.apiKey, payload }), signal: controller.signal,
      }), controller.signal);
    }
    if (!response.body) throw new Error('模型接口没有返回响应正文。');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decode = (bytes?: Uint8Array, stream = false) => {
      try { return decoder.decode(bytes, { stream }); }
      catch { throw new Error('模型响应包含无效或截断的 UTF-8 文本。'); }
    };
    const contentType = response.headers.get('content-type') ?? '';
    let mode: 'sse' | 'json' | undefined = /text\/event-stream/i.test(contentType) ? 'sse'
      : /json/i.test(contentType) ? 'json' : undefined;
    if (mode === 'json') {
      buffered = true;
      emit('receiving');
    }
    let textBuffer = '';
    let bufferedBytes = 0;
    let wireBytes = 0;
    const buffer = (text: string) => {
      bufferedBytes += encoder.encode(text).byteLength;
      if (bufferedBytes > MAX_BUFFERED_RESPONSE_BYTES) throw new Error('模型整包或未知格式响应超过 2MB 安全上限，已停止接收。');
      textBuffer += text;
    };
    const decoded = (text: string, final = false) => {
      if (!response.ok) { buffer(text); return; }
      if (!mode) {
        const prefix = (textBuffer + text).trimStart();
        if (prefix.startsWith('{') || prefix.startsWith('[')) { mode = 'json'; buffered = true; }
        else if (/^(?:data:|event:|id:|retry:|:)/.test(prefix)) mode = 'sse';
        else if (final) throw new Error('模型返回了未知格式的响应。');
        if (!mode) { buffer(text); return; }
        text = textBuffer + text;
        textBuffer = '';
        bufferedBytes = 0;
      }
      if (mode === 'sse') consume(text, final);
      else buffer(text);
    };
    while (!done) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (chunk.done) { decoded(decode(), true); break; }
      if (!chunk.value.byteLength) continue;
      clearTimeout(firstByteTimer);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop('模型连续 60 秒未返回数据，接收超时。请手动重试或使用部分结果。'), IDLE_TIMEOUT_MS);
      wireBytes += chunk.value.byteLength;
      if (wireBytes > MAX_STREAM_BYTES) throw new Error('模型总传输量超过 32MB 安全上限（含协议及推理数据），已停止接收。');
      decoded(decode(chunk.value, true));
    }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!response.ok) {
      let detail = textBuffer;
      try { const data = JSON.parse(textBuffer); detail = providerError(data) ?? data.message ?? detail; } catch { /* Keep bounded HTTP body. */ }
      throw new Error(readableError(response.status, String(detail)));
    }
    if (mode === 'json') {
      let data: unknown;
      try { data = JSON.parse(textBuffer); } catch { throw new Error('模型接口的 JSON 响应不完整或格式错误。'); }
      const error = providerError(data);
      if (error) throw new Error(`模型响应失败：${error}`);
      const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
      if (isRecord(choice) && isRecord(choice.message)
        && (choice.message.role === undefined || choice.message.role === 'assistant')) append(assistantText(choice.message.content));
      lengthLimited = isRecord(choice) && choice.finish_reason === 'length';
      if (isRecord(choice) && choice.finish_reason === 'content_filter') throw new Error('模型停止了输出：内容被接口过滤。');
    }
    responseComplete = true;
    emit('validating');
    controller.signal.throwIfAborted();
    if (lengthLimited) throw new Error('模型输出达到 token 上限，结果可能被截断。请手动重试或使用部分结果。');
    if (!raw.trim()) throw new Error('模型没有返回可解析的正文，请手动重试或更换视觉模型。');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw, (_key, value: unknown) => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number');
        return value;
      });
    } catch {
      throw new Error('模型输出不是完整合法的 JSON（可能被截断）。请手动重试或使用已接收的部分结果。');
    }
    return normalizeFloorPlan(parsed, 'AI 识别户型');
  } catch (error) {
    if (raw && !responseComplete) emit('receiving');
    throw new RecognitionError(interrupted || (isAbort(error) ? '识别已取消。'
      : error instanceof TypeError ? '网络连接中断，请检查网络后手动重试。'
        : error instanceof Error ? error.message : '识别失败，请手动重试。'), raw);
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(firstByteTimer);
    clearTimeout(idleTimer);
    clearTimeout(progressTimer);
    options.signal?.removeEventListener('abort', cancel);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    controller.abort();
  }
}

export function imageTargetDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效，请换一张图片。');
  }
  const ratio = Math.min(1, 2048 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => { reader.onload = null; reader.onerror = null; reader.onabort = null; };
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = reader.onabort = () => { cleanup(); reject(new Error('图片读取失败，请换一张图片。')); };
    try { reader.readAsDataURL(file); }
    catch { cleanup(); reject(new Error('图片读取失败，请换一张图片。')); }
  });
}

export async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    // HTMLImageElement decoding uses the browser's EXIF orientation handling.
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片解码失败，文件可能损坏，请换一张 JPG、PNG 或 WebP 图片。'));
      image.src = url;
    });
    const dimensions = imageTargetDimensions(image.naturalWidth, image.naturalHeight);
    const scaled = dimensions.width !== image.naturalWidth || dimensions.height !== image.naturalHeight;
    if (!scaled && file.size <= 64 * 1024) return await readDataUrl(file);
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请换一张较小的图片。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.9);
    if (!compressed.startsWith('data:image/jpeg;base64,')) throw new Error('图片压缩失败，请换一张图片。');
    if (scaled) return compressed;
    const original = await readDataUrl(file);
    return compressed.length < original.length ? compressed : original;
  } catch (error) {
    throw new Error(error instanceof Error && /图片|浏览器/.test(error.message)
      ? error.message : '图片处理失败，请换一张 JPG、PNG 或 WebP 图片。');
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function validateImageFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '仅支持 JPG / PNG / WebP 图片。';
  if (file.size > 10 * 1024 * 1024) return '图片不能超过 10MB。';
  return null;
}
