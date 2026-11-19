import { normalizeFloorPlan } from '../core/schema';
import type { FloorPlan, ModelConfig } from '../core/schema';

export const MODEL_PRESETS = [
  { model: 'qwen-vl-max', label: 'Qwen-VL-Max（推荐）' },
  { model: 'deepseek-flash', label: 'DeepSeek-Flash（支持视觉）' },
  { model: 'qwen-vl-plus', label: 'Qwen-VL-Plus' },
  { model: 'gpt-4o', label: 'GPT-4o' },
  { model: 'gpt-4o-mini', label: 'GPT-4o-mini' },
  { model: 'glm-4v-plus', label: 'GLM-4V-Plus' },
];

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export function isReasoningModel(config: ModelConfig) {
  return /deepseek/i.test(config.model) || /deepseek/i.test(config.baseUrl);
}

export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen-vl-max';

export type RecognitionStage = 'upload' | 'recognize' | 'generate' | 'done';

const SYSTEM_PROMPT = '你是专业的建筑户型图识别引擎。你只输出一个合法 JSON 对象，不输出解释、Markdown 或代码块。所有坐标单位为米，x 向右、y 向下。墙体用中心线线段表示，房间用闭合多边形表示，门窗偏移量从墙体 start 沿 end 方向计算。';

const USER_PROMPT = `请识别这张户型图纸照片，输出结构化 JSON。要求：
1. 尽量读取图纸标注尺寸；若没有标注，按标准门宽约 0.9m 推算比例，scaleSource 填 "door-reference"，有标注填 "annotation"。
2. walls 覆盖外墙与内墙，thickness 常见 0.12~0.24；rooms 覆盖所有可识别房间，type 只能是 bedroom/living/kitchen/bathroom/balcony/dining/study/entry/other。
3. openings 的 wallId 必须引用 walls.id；door 高度约 2.1、sillHeight 0；window 高度约 1.2~1.5、sillHeight 约 0.9。
4. 对模糊、被遮挡或无法确认的墙和房间给较低 confidence（0~1），不要编造不存在的空间。
5. furniture 只输出图中明确画出且能辨认类别的家具，不根据房间用途凭空添加；没有清晰家具时输出 []。model 仅支持 bed-double/bed-single/wardrobe/nightstand/desk/sofa/coffee-table/tv-console/bookshelf/floor-lamp/dining-table/dining-chair/fridge/kitchen-cabinet/stove/toilet/vanity/bathtub/shower/plant/rug/accent-chair。数组元素格式为 {"id":"f1","model":"toilet","roomId":"r1","position":[1,1],"rotation":0,"color":"walnut"}；position 是家具中心点，roomId 必须引用 rooms.id，color 只能是 walnut/oak/sage。
6. rotation 使用弧度，优先取 0、1.5708、3.1416、-1.5708。所有家具正面均为模型局部 +z，在图纸平面中的正方向为 [sin(rotation),cos(rotation)]：0 朝 +y，1.5708 朝 +x，3.1416 朝 -y，-1.5708 朝 -x。先辨认家具自身前后特征，再换算 rotation，不要把图像上方直接当成家具背面。
7. 马桶水箱、床头、沙发靠背和柜体背面应靠近实墙，马桶座圈前方、床尾、沙发座位前方和柜门应朝房间内可用空间，不得朝向墙体或紧贴其他家具。前后特征模糊时，结合最近实墙和可用空间判断，不要按图纸上下方向臆测；类别或位置也不清晰时不要输出该家具。
8. 输出紧凑单行 JSON：不要换行与多余空格，不要 Markdown 代码块，不要任何解释文字。
9. 只输出如下 Schema 的 JSON：
{"version":1,"name":"户型名称","unit":"m","scaleSource":"annotation|door-reference","totalAreaHint":数字或省略,"wallHeight":2.8,"walls":[{"id":"w1","start":[0,0],"end":[4.2,0],"thickness":0.24,"confidence":0.9}],"openings":[{"id":"o1","wallId":"w1","type":"door|window","offset":1.2,"width":0.9,"height":2.1,"sillHeight":0}],"rooms":[{"id":"r1","name":"主卧","type":"bedroom","polygon":[[0,0],[4.2,0],[4.2,3.6],[0,3.6]],"confidence":0.9}],"furniture":[]}`;

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
    return '该模型不接受图像输入，请更换支持视觉的模型（如 qwen-vl-max、gpt-4o）。';
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
  throw new RecognitionError('模型输出不是合法 JSON（可能被截断或夹带解释文字），已自动重试仍失败。可展开下方原始输出排查，或更换模型。', content);
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
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const proxyResponse = await fetch('/api/model-proxy', {
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
    if (error instanceof DOMException && error.name === 'AbortError') {
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
      model: config.model,
      stream: false,
      max_tokens: reasoning ? 1024 : 8,
      ...(reasoning ? { effort: 'low' } : {}),
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

const RETRY_PROMPT = '你上一次的输出无法解析为合法 JSON（可能被截断、含解释文字或格式错误）。请重新识别图片，只输出一个完整、紧凑、合法的 JSON 对象，严格遵循之前的 Schema，不要任何其它文字。';

export async function recognizeFloorPlan(
  config: ModelConfig,
  imageDataUrl: string,
  onStage?: (stage: RecognitionStage) => void,
): Promise<FloorPlan> {
  const reasoning = isReasoningModel(config);
  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: [{ type: 'text', text: USER_PROMPT }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
  ];
  const attempt = async (messages: unknown[], maxTokens: number): Promise<FloorPlan> => {
    const response = await postChat(config, {
      model: config.model,
      stream: false,
      temperature: 0.1,
      max_tokens: maxTokens,
      ...(reasoning ? { effort: 'low' } : {}),
      messages,
    }, 300_000);
    let raw: string;
    try {
      raw = messageContent(response);
    } catch {
      throw new RecognitionError('模型没有返回正文：推理型模型可能把 token 预算耗在了内部推理上。已自动加大预算重试；若仍失败，可换用 qwen-vl-max 等视觉模型。', '');
    }
    if (!raw.trim()) {
      throw new RecognitionError('模型返回了空内容（输出被截断）。已自动加大预算重试；若仍失败，可换用 qwen-vl-max 等视觉模型。', raw);
    }
    try {
      return normalizeFloorPlan(parseModelJson(raw), 'AI 识别户型');
    } catch (error) {
      throw new RecognitionError(error instanceof Error ? error.message : '识别结果无效。', raw);
    }
  };

  onStage?.('upload');
  onStage?.('recognize');
  try {
    const plan = await attempt(baseMessages, reasoning ? 32_768 : 8192);
    onStage?.('generate');
    onStage?.('done');
    return plan;
  } catch (first) {
    if (!(first instanceof RecognitionError)) throw first;
    onStage?.('recognize');
    try {
      const retryMessages = first.raw
        ? [...baseMessages, { role: 'assistant', content: first.raw }, { role: 'user', content: RETRY_PROMPT }]
        : [...baseMessages, { role: 'user', content: RETRY_PROMPT }];
      const plan = await attempt(retryMessages, reasoning ? 65_536 : 16_384);
      onStage?.('generate');
      onStage?.('done');
      return plan;
    } catch (second) {
      throw second instanceof RecognitionError ? second : first;
    }
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败，请换一张图片。'));
    reader.readAsDataURL(file);
  });
}

export function validateImageFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '仅支持 JPG / PNG / WebP 图片。';
  if (file.size > 10 * 1024 * 1024) return '图片不能超过 10MB。';
  return null;
}
