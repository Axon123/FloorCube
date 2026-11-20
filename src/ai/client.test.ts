import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL_PRESETS, DEFAULT_BASE_URL, DEFAULT_MODEL, MODEL_PRESETS, RecognitionError, fileToDataUrl, getRecognitionSettings, getRequestModel, imageTargetDimensions, parseModelJson, recognizeFloorPlan, testConnection, validateImageFile } from './client';
import type { RecognitionProgress } from './client';
import { FURNITURE_CATALOG } from '../models/catalog';

const PLAN = '{"version":1,"name":"测试","unit":"m","wallHeight":2.8,"walls":[{"id":"w1","start":[0,0],"end":[4,0],"thickness":0.24,"confidence":0.9}],"openings":[],"rooms":[{"id":"r1","name":"客厅","type":"living","polygon":[[0,0],[4,0],[4,3],[0,3]],"confidence":0.9}],"furniture":[]}';

describe('模型接口预设', () => {
  it('默认使用 DeepSeek Flash 与 DeepSeek 官方接口', () => {
    expect(DEFAULT_MODEL).toBe('deepseek-flash');
    expect(DEFAULT_BASE_URL).toBe('https://api.deepseek.com');
    expect(MODEL_PRESETS).toEqual([{ model: 'deepseek-flash', label: 'DeepSeek Flash' }]);
  });

  it('只提供百炼与 DeepSeek 两个官方地址', () => {
    expect(BASE_URL_PRESETS).toEqual([
      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '阿里云百炼官方' },
      { baseUrl: 'https://api.deepseek.com', label: 'DeepSeek 官方' },
    ]);
    expect(BASE_URL_PRESETS.some((preset) => preset.baseUrl === DEFAULT_BASE_URL)).toBe(true);
  });
});

describe('百炼 Flash 模型名', () => {
  it.each([
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
    'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  ])('仅对百炼接口匹配预设的实际模型（%s）', (baseUrl) => {
    const config = { baseUrl, model: 'deepseek-flash' };
    expect(getRequestModel(config)).toBe('deepseek-v4.1-flash');
    expect(config).toEqual({ baseUrl, model: 'deepseek-flash' });
  });

  it.each([
    ['https://api.deepseek.com', 'deepseek-flash'],
    ['https://example.com/v1', 'deepseek-flash'],
    ['https://dashscope.aliyuncs.com.example.com/v1', 'deepseek-flash'],
    ['https://workspace.cn-beijing.maas.aliyuncs.com.example.com/v1', 'deepseek-flash'],
    ['https://example.com/dashscope.aliyuncs.com', 'deepseek-flash'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'custom-vision-model'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-v4.1-flash-1017'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-v4.1-flash'],
  ])('不改写第三方网关或明确指定的自定义模型（%s, %s）', (baseUrl, model) => {
    expect(getRequestModel({ baseUrl, model })).toBe(model);
  });
});

describe('parseModelJson', () => {
  it('解析紧凑 JSON', () => {
    expect(parseModelJson(PLAN)).toMatchObject({ name: '测试' });
  });

  it('剥离 Markdown 代码块', () => {
    expect(parseModelJson('```json\n' + PLAN + '\n```')).toMatchObject({ name: '测试' });
  });

  it('提取夹带解释文字中的 JSON', () => {
    expect(parseModelJson('好的，识别结果如下：' + PLAN + ' 希望对你有帮助。')).toMatchObject({ name: '测试' });
  });

  it('容忍尾逗号', () => {
    const withComma = PLAN.replace('"furniture":[]', '"furniture":[],');
    expect(parseModelJson(withComma)).toMatchObject({ name: '测试' });
  });

  it('修复数组中途截断', () => {
    const cut = PLAN.indexOf('"rooms"');
    const repaired = parseModelJson(PLAN.slice(0, cut)) as { walls: unknown[] };
    expect(repaired.walls).toHaveLength(1);
  });

  it('修复字符串中途截断', () => {
    const cut = PLAN.indexOf('"rooms"') + 14;
    const repaired = parseModelJson(PLAN.slice(0, cut)) as { walls: unknown[] };
    expect(repaired.walls).toHaveLength(1);
  });

  it('纯拒绝文本抛出带原始输出的 RecognitionError', () => {
    try {
      parseModelJson('抱歉，我无法识别这张图片。');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RecognitionError);
      expect((error as RecognitionError).raw).toContain('抱歉');
    }
  });
});

describe('识别提示词', () => {
  it('明确家具正方向、模糊图像处理和高频贴墙规则', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: PLAN } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await recognizeFloorPlan({ baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'qwen-vl-max' }, 'data:image/png;base64,AA==');
      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      const prompt = body.messages[1].content[0].text as string;
      expect(prompt).toContain('[sin(rotation),cos(rotation)]');
      expect(prompt).toContain('马桶水箱、床头、沙发靠背');
      expect(prompt).toContain('前后特征模糊时');
      expect(prompt).toContain('不根据房间用途凭空添加');
      expect(prompt).toContain(`model 仅支持 ${FURNITURE_CATALOG.map((item) => item.id).join('/')}。`);
      expect(prompt).toContain('按标准门宽约 0.9m 推算比例');
      expect(prompt).toContain('尽量读取图纸标注尺寸');
      expect(prompt).toContain('不要编造不存在的空间');
      expect(prompt).toContain('walls、rooms、openings、furniture');
      expect(prompt).toContain('紧凑单行 JSON');
      const schema = prompt.slice(prompt.indexOf('{"version"'));
      expect(schema.indexOf('"walls"')).toBeLessThan(schema.indexOf('"rooms"'));
      expect(schema.indexOf('"rooms"')).toBeLessThan(schema.indexOf('"openings"'));
      expect(schema.indexOf('"openings"')).toBeLessThan(schema.indexOf('"furniture"'));
      expect(body.stream).toBe(true);
      expect(body.max_tokens).toBe(8192);
      expect(body).not.toHaveProperty('effort');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const CONFIG = { baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'qwen-vl-max' };
const IMAGE = 'data:image/png;base64,AA==';
const WALL = { id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.24, confidence: 0.9 };
const ROOM = { id: 'r1', name: '客厅', type: 'living', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], confidence: 0.9 };
const OPENING = { id: 'o1', wallId: 'w1', type: 'door', offset: 1, width: 0.9, height: 2.1, sillHeight: 0 };
const FURNITURE = { id: 'f1', roomId: 'r1', model: 'toilet', position: [1, 1], rotation: 1.5708, color: 'walnut' };
const encoder = new TextEncoder();

function event(content: string, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, ...extra }] })}\n\n`;
}

function streamHarness(contentType = 'text/event-stream') {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
  const response = new Response(body, { headers: { 'Content-Type': contentType } });
  return {
    response, body, cancel,
    send: (value: string | Uint8Array) => controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value),
    end: () => controller.close(),
    fail: () => controller.error(new TypeError('socket reset')),
  };
}

function bufferedResponse(content = PLAN, finish_reason = 'stop') {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function startStream(contentType?: string) {
  const stream = streamHarness(contentType);
  const fetchMock = vi.fn().mockResolvedValue(stream.response);
  vi.stubGlobal('fetch', fetchMock);
  const progress: RecognitionProgress[] = [];
  const result = recognizeFloorPlan(CONFIG, IMAGE, { onProgress: (value) => progress.push(value) });
  // Attach a rejection handler immediately, including in fake-timer tests.
  const outcome = result.catch((error: unknown) => error as RecognitionError);
  return { ...stream, fetchMock, progress, result, outcome };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('流式识别与累积预览', () => {
  it('响应结束前显示实际字符和完整对象，不修补未闭合对象、不生成占位房间', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    let complete = false;
    void stream.result.then(() => { complete = true; });
    const prefix = '{"walls":[' + JSON.stringify(WALL).slice(0, -1);
    stream.send(event(prefix));
    await settle();
    expect(stream.progress.at(-1)).toMatchObject({ phase: 'receiving', receivedChars: prefix.length, partial: null, buffered: false });
    stream.send(event('},'));
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    const wallsOnly = stream.progress.at(-1)!.partial!;
    expect(wallsOnly.walls.map((wall) => wall.id)).toEqual(['w1']);
    expect(wallsOnly.rooms).toEqual([]);
    expect(complete).toBe(false);
    const wall2 = { ...WALL, id: 'w2', start: [4, 0], end: [4, 3] };
    stream.send(event(JSON.stringify(wall2) + '],"rooms":[' + JSON.stringify(ROOM) + '],"openings":[],"furniture":[]}'));
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(stream.progress.at(-1)!.partial!.walls.map((wall) => wall.id)).toEqual(['w1', 'w2']);
    expect(stream.progress.at(-1)!.partial!.rooms.map((room) => room.id)).toEqual(['r1']);
    expect(wallsOnly.walls).toHaveLength(1); // Earlier snapshots are immutable.
    expect(complete).toBe(false);
    expect(stream.progress.some((value) => value.phase === 'validating')).toBe(false);
    stream.send('data: [DONE]\n\n');
    expect((await stream.result).walls).toHaveLength(2);
    expect(stream.progress.at(-1)?.phase).toBe('validating');
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('UTF-8 单字节分块、拆分 CRLF、多行 data、注释和多个事件均可解析', async () => {
    const stream = startStream();
    const raw = JSON.stringify({ ...JSON.parse(PLAN), name: '户型𠀀', rooms: [{ ...ROOM, name: '客厅 [窗] {门} "转角" \\ 阳台' }] });
    const payload = JSON.stringify({ choices: [{ delta: { content: raw } }] });
    const separator = payload.indexOf('[{');
    const multiline = `: keepalive\r\n\r\nevent: message\r\nid: 42\r\ndata: ${payload.slice(0, separator)}\r\ndata: ${payload.slice(separator)}\r\n\r\n`;
    for (const byte of encoder.encode(multiline + 'data: [DONE]\r\n\r\n')) stream.send(Uint8Array.of(byte));
    const plan = await stream.result;
    expect(plan.name).toBe('户型𠀀');
    expect(plan.rooms[0].name).toBe('客厅 [窗] {门} "转角" \\ 阳台');
    expect(stream.progress.at(-1)?.receivedChars).toBe(raw.length);
    expect(stream.progress.at(-1)?.partial?.rooms[0].id).toBe('r1');
  });

  it('只累积 assistant 正文，忽略 reasoning、工具文本、其他 choice 与 usage', async () => {
    const stream = startStream();
    stream.send('data: {"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"秘密推理","reasoning":"不展示"}}]}\n\n');
    await settle();
    expect(stream.progress).toHaveLength(1);
    stream.send('data: {"choices":[{"index":0,"delta":{"role":"tool","content":"工具文本"}}]}\n\n');
    stream.send(`data: ${JSON.stringify({ choices: [{ index: 1, delta: { content: '其他输出' } }, { index: 0, delta: { role: 'assistant', content: [{ type: 'reasoning', text: '秘密' }, { type: 'text', text: PLAN }] } }] })}\n\n`);
    stream.send('data: {"choices":[],"usage":{"total_tokens":9999}}\n\ndata: [DONE]\n\n');
    await stream.result;
    expect(stream.progress.at(-1)?.receivedChars).toBe(PLAN.length);
    expect(JSON.stringify(stream.progress)).not.toContain('秘密');
  });

  it.each(['text/event-stream', 'text/plain'])('长推理与协议开销超过 2MB 后仍可逐步接收户型（%s）', async (contentType) => {
    const stream = startStream(contentType);
    const reasoningEvent = `data: ${JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion.chunk', model: 'test-vision',
      provider_metadata: { trace: 'x'.repeat(256) },
      choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '测试推理片段', content: null } }],
    })}\r\n\r\n`;
    const overhead = reasoningEvent.repeat(6000);
    expect(encoder.encode(overhead).byteLength).toBeGreaterThan(2 * 1024 * 1024);
    stream.send(overhead);
    await settle();
    expect(stream.cancel).not.toHaveBeenCalled();
    expect(stream.progress).toHaveLength(1);
    expect(stream.progress[0]).toMatchObject({ receivedChars: 0, partial: null });
    const split = PLAN.indexOf('"rooms"');
    stream.send(event(PLAN.slice(0, split)));
    await settle();
    expect(stream.progress.at(-1)?.partial?.walls).toHaveLength(1);
    stream.send(event(PLAN.slice(split)) + 'data: [DONE]\n\n');
    expect((await stream.result).rooms).toHaveLength(1);
    expect(stream.progress.at(-1)?.receivedChars).toBe(PLAN.length);
    expect(JSON.stringify(stream.progress)).not.toContain('测试推理片段');
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it('有正文但没有完整结构时也报告 receiving；快照最多约每秒四次，结束强制刷新', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    stream.send(event(PLAN.slice(0, 1)));
    await settle();
    for (let i = 1; i < 21; i += 1) {
      stream.send(event(PLAN.slice(i, i + 1)));
      await settle();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(stream.progress.filter((value) => value.phase === 'receiving')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(stream.progress.filter((value) => value.phase === 'receiving')).toHaveLength(2);
    expect(stream.progress.at(-1)?.receivedChars).toBe(21);
    expect(stream.progress.at(-1)?.partial).toBeNull();
    stream.send(event(PLAN.slice(21)) + 'data: [DONE]\n\n');
    await stream.result;
    expect(stream.progress.at(-1)).toMatchObject({ phase: 'validating', receivedChars: PLAN.length });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('只使用顶层数组完整元素；跳过无效几何、缺少 ID 与不存在的引用', async () => {
    const stream = startStream();
    const raw = JSON.stringify({
      metadata: { walls: [{ ...WALL, id: 'nested' }] },
      walls: [null, { ...WALL, id: undefined }, { ...WALL, id: 'bad-y', end: [4, 'NaN'] },
        { ...WALL, id: 'zero', end: [0, 0] }, { ...WALL, id: 'huge', end: [1e200, 3] }, WALL, { ...WALL, end: [7, 0] }],
      rooms: [{ ...ROOM, id: 'invalid', polygon: [[0, 0], [3, null], [0, 3]] }, ROOM],
      openings: [OPENING, { ...OPENING, id: 'bad', wallId: 'absent' }, { ...OPENING, id: 'nan', width: 'x' }],
      furniture: [FURNITURE, { ...FURNITURE, id: 'absent', roomId: 'absent' }, { ...FURNITURE, id: 'nan', position: [0, null] }],
    });
    // Preview before the root object closes; do not validate the deliberately bad final plan.
    stream.send(event(raw.slice(0, -1)));
    await settle();
    const plan = stream.progress.at(-1)!.partial!;
    expect(plan.walls.map((wall) => wall.id)).toEqual(['w1']);
    expect(plan.walls[0].end).toEqual([4, 0]);
    expect(plan.rooms.map((room) => room.id)).toEqual(['r1']);
    expect(plan.openings.map((opening) => opening.id)).toEqual(['o1']);
    expect(plan.furniture.map((item) => item.id)).toEqual(['f1']);
    expect(plan.furniture[0].rotation).toBe(1.5708);
    stream.end();
    expect(await stream.outcome).toBeInstanceOf(RecognitionError);
  });

  it('乱序引用等到对应墙或房间完成才加入，房间不能生成推测墙体', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    stream.send(event(`{"openings":[${JSON.stringify(OPENING)}],"furniture":[${JSON.stringify(FURNITURE)}],"rooms":[${JSON.stringify(ROOM)}]`));
    await settle();
    expect(stream.progress.at(-1)?.partial?.walls).toEqual([]);
    expect(stream.progress.at(-1)?.partial?.openings).toEqual([]);
    expect(stream.progress.at(-1)?.partial?.furniture.map((item) => item.id)).toEqual(['f1']);
    stream.send(event(`,"walls":[${JSON.stringify(WALL)}]}`));
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(stream.progress.at(-1)?.partial?.openings.map((item) => item.id)).toEqual(['o1']);
    stream.send('data: [DONE]\n\n');
    expect((await stream.result).walls[0].id).toBe('w1');
  });

  it('缺失 content-type 时识别 SSE；正常 EOF 也可结束完整 JSON', async () => {
    const stream = startStream('application/octet-stream');
    stream.send(event(PLAN, { finish_reason: 'stop' }));
    stream.end();
    expect((await stream.result).name).toBe('测试');
    expect(stream.progress.at(-1)?.buffered).toBe(false);
  });

  it('不把已经闭合的 polygon 子数组当成完整房间', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    const prefix = `{"walls":[${JSON.stringify(WALL)}],"rooms":[{"id":"r1","name":"客厅 \\\"{[]}\\\"","type":"living","polygon":[[0,0],[4,0],[4,3],[0,3]]`;
    stream.send(event(prefix));
    await settle();
    expect(stream.progress.at(-1)?.partial?.rooms).toEqual([]);
    stream.send(event('}],"openings":[],"furniture":[]}'));
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(stream.progress.at(-1)?.partial?.rooms[0].name).toBe('客厅 "{[]}"');
    stream.send('data: [DONE]\n\n');
    await stream.result;
  });

  it('最终结果保留尺寸、比例来源、家具方向和稳定 ID', async () => {
    const source = {
      version: 1, name: '实测户型', unit: 'm', scaleSource: 'annotation', wallHeight: 3.1, totalAreaHint: 12,
      walls: [WALL], rooms: [ROOM], openings: [OPENING], furniture: [FURNITURE],
    };
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse(JSON.stringify(source)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await recognizeFloorPlan(CONFIG, IMAGE)).toEqual(source);
  });
});

describe('识别模式', () => {
  const deepseek = { ...CONFIG, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };
  const qwen = { ...CONFIG, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' };

  it('默认快速模式明确关闭 DeepSeek 思考，保留完整 JSON 与家具要求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    expect((await recognizeFloorPlan(deepseek, IMAGE)).rooms).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ stream: true, max_tokens: 8192, thinking: { type: 'disabled' } });
    expect(body).not.toHaveProperty('effort');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('extra_body');
    const prompt = body.messages[1].content[0].text;
    expect(prompt).toContain('识别模式：快速');
    expect(prompt).toContain('仍须完整遵守上述 Schema 与家具识别要求');
    expect(prompt).toContain('不根据房间用途凭空添加');
    expect(body.messages[1].content[1].image_url.url).toBe(IMAGE);
    expect(getRecognitionSettings(deepseek, 'fast').note).toContain('关闭思考');
  });

  it('精细模式使用正确的 DeepSeek 思考字段与充足输出预算', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await recognizeFloorPlan(deepseek, IMAGE, { mode: 'detailed' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ stream: true, max_tokens: 32768, thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    expect(body).not.toHaveProperty('effort');
    expect(body).not.toHaveProperty('enable_thinking');
    expect(body.messages[1].content[0].text).toContain('识别模式：精细');
    expect(body.messages[1].content[0].text).toContain('墙体连通、尺寸比例、门窗引用和家具朝向');
    expect(getRecognitionSettings(deepseek, 'detailed').note).toContain('费用更高');
  });

  it.each(['fast', 'detailed'] as const)('百炼 Flash 使用实际模型与顶层思考参数（%s）', async (mode) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(bufferedResponse()));
    vi.stubGlobal('fetch', fetchMock);
    for (const config of [
      { ...CONFIG, baseUrl: qwen.baseUrl, model: 'deepseek-flash' },
      { ...CONFIG, baseUrl: qwen.baseUrl, model: 'deepseek-v4.1-flash' },
      { ...CONFIG, baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
      { ...CONFIG, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
    ]) {
      const before = { ...config };
      await recognizeFloorPlan(config, IMAGE, { mode });
      const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
      expect(body).toMatchObject({
        model: 'deepseek-v4.1-flash', stream: true,
        enable_thinking: mode === 'detailed', max_tokens: mode === 'detailed' ? 32768 : 8192,
      });
      if (mode === 'detailed') expect(body.reasoning_effort).toBe('high');
      else expect(body).not.toHaveProperty('reasoning_effort');
      for (const field of ['thinking', 'thinking_budget', 'extra_body', 'effort']) expect(body).not.toHaveProperty(field);
      expect(body.messages[1].content[0].text).toContain(`识别模式：${mode === 'fast' ? '快速' : '精细'}`);
      expect(body.messages[1].content[1].image_url.url).toBe(IMAGE);
      expect(getRecognitionSettings(config, mode).note).toContain('百炼 deepseek-v4.1-flash');
      expect(getRecognitionSettings(config, mode).note).toContain(mode === 'fast' ? '关闭思考' : '开启思考');
      expect(config).toEqual(before);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['fast', 'detailed'] as const)('百炼 Flash 直连与代理保持同一模型和模式（%s）', async (mode) => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await recognizeFloorPlan({ ...qwen, model: 'deepseek-flash' }, IMAGE, { mode });
    const direct = JSON.parse(fetchMock.mock.calls[0][1].body);
    const proxied = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(proxied.payload).toEqual(direct);
    expect(direct.model).toBe('deepseek-v4.1-flash');
    expect(direct.enable_thinking).toBe(mode === 'detailed');
    expect(proxied.baseUrl).toBe(qwen.baseUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['fast', 'detailed'] as const)('Qwen 混合思考模型使用顶层原生参数（%s）', async (mode) => {
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await recognizeFloorPlan(qwen, IMAGE, { mode });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.enable_thinking).toBe(mode === 'detailed');
    expect(body.max_tokens).toBe(mode === 'detailed' ? 32768 : 8192);
    if (mode === 'detailed') expect(body.thinking_budget).toBe(8192);
    else expect(body).not.toHaveProperty('thinking_budget');
    for (const key of ['thinking', 'reasoning_effort', 'effort', 'extra_body']) expect(body).not.toHaveProperty(key);
  });

  it.each([
    ['https://api.deepseek.com', 'deepseek-v4-pro'],
    ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen3-vl-plus-2025-12-19'],
    ['https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', 'qwen3.5-plus'],
  ])('仅在已适配原生模型上发送思考参数（%s, %s）', (baseUrl, model) => {
    const settings = getRecognitionSettings({ ...CONFIG, baseUrl, model }, 'detailed');
    expect(settings.note).toContain('开启思考');
    expect(settings.parameters.max_tokens).toBe(32768);
  });

  it.each([
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-vl-max'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3-vl-235b-a22b-thinking'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-r1'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-v4.1-flash-1017'],
    ['https://dashscope.aliyuncs.com.example.com/v1', 'deepseek-v4.1-flash'],
    ['https://workspace.cn-beijing.maas.aliyuncs.com.example.com/v1', 'deepseek-flash'],
    ['https://example.com/v1', 'deepseek-v4.1-flash'],
    ['https://api.deepseek.com', 'deepseek-reasoner'],
    ['https://api.deepseek.com', 'custom-model'],
    ['https://api.openai.com/v1', 'gpt-4o'],
    ['https://api.deepseek.com.example.com/v1', 'deepseek-flash'],
    ['https://example.com/deepseek/v1', 'deepseek-flash'],
    ['https://example.com/v1', 'qwen3-vl-plus'],
  ])('不向未适配模型或中转接口乱发思考字段（%s, %s）', async (baseUrl, model) => {
    const config = { ...CONFIG, baseUrl, model };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(bufferedResponse()));
    vi.stubGlobal('fetch', fetchMock);
    for (const mode of ['fast', 'detailed'] as const) {
      await recognizeFloorPlan(config, IMAGE, { mode });
      const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
      for (const key of ['thinking', 'reasoning_effort', 'effort', 'enable_thinking', 'thinking_budget']) expect(body).not.toHaveProperty(key);
      expect(body.messages[1].content[0].text).toContain(`识别模式：${mode === 'fast' ? '快速' : '精细'}`);
      expect(getRecognitionSettings(config, mode).note).toContain('仅调整识别侧重点');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['fast', 'detailed'] as const)('网络回退代理保留同一次请求的模式和图片（%s）', async (mode) => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await recognizeFloorPlan(deepseek, IMAGE, { mode });
    const direct = JSON.parse(fetchMock.mock.calls[0][1].body);
    const proxied = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(proxied.payload).toEqual(direct);
    expect(direct.thinking.type).toBe(mode === 'fast' ? 'disabled' : 'enabled');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('错误、取消、期限与兼容响应', () => {
  it('非流式接口在响应头到达时明确提示，完整正文到达前不虚报数据进度', async () => {
    const stream = startStream('application/json');
    const body = JSON.stringify({ choices: [{ message: { content: PLAN, reasoning_content: '隐藏' } }] });
    stream.send(body.slice(0, 70));
    await settle();
    expect(stream.progress).toHaveLength(2);
    expect(stream.progress.at(-1)).toMatchObject({ buffered: true, receivedChars: 0, partial: null });
    stream.send(body.slice(70));
    await settle();
    expect(stream.progress).toHaveLength(2);
    expect(stream.progress.at(-1)?.receivedChars).toBe(0);
    stream.end();
    expect((await stream.result).rooms[0].id).toBe('r1');
    expect(stream.progress.slice(1).every((value) => value.buffered)).toBe(true);
    expect(stream.progress.at(-1)?.receivedChars).toBe(PLAN.length);
  });

  it('非流式响应的文本 parts 排除推理内容，并可探测错误 content-type', async () => {
    const stream = startStream('text/plain');
    stream.send(JSON.stringify({ choices: [{ message: { content: [{ type: 'reasoning', text: '隐藏' }, { type: 'text', text: PLAN }] } }] }));
    stream.end();
    expect((await stream.result).name).toBe('测试');
    expect(stream.progress.at(-1)).toMatchObject({ buffered: true, receivedChars: PLAN.length });
  });

  it.each(['stream', 'json'])('截断的 %s 正文抛出带 raw 的错误，不自动重试', async (transport) => {
    const raw = PLAN.slice(0, PLAN.indexOf('"rooms"'));
    const stream = startStream(transport === 'json' ? 'application/json' : undefined);
    stream.send(transport === 'json' ? JSON.stringify({ choices: [{ message: { content: raw } }] }) : event(raw) + 'data: [DONE]\n\n');
    if (transport === 'json') stream.end();
    expect(await stream.outcome).toMatchObject({ name: 'RecognitionError', raw, message: expect.stringContaining('完整合法') });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(stream.progress.at(-1)?.partial?.walls).toHaveLength(1);
    expect(stream.progress.at(-1)?.partial?.rooms).toEqual([]);
  });

  it.each(['stream', 'json'])('%s finish_reason=length 即使 JSON 已闭合也报截断', async (transport) => {
    const stream = startStream(transport === 'json' ? 'application/json' : undefined);
    stream.send(transport === 'json' ? JSON.stringify({ choices: [{ message: { content: PLAN }, finish_reason: 'length' }] })
      : event(PLAN, { finish_reason: 'length' }) + 'data: [DONE]\n\n');
    if (transport === 'json') stream.end();
    expect(await stream.outcome).toMatchObject({ raw: PLAN, message: expect.stringContaining('token 上限') });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    'event: error\ndata: {"message":"provider unavailable"}\n\n',
    'data: {"error":{"message":"provider unavailable"}}\n\n',
    'event: error\ndata: provider unavailable\n\n',
  ])('捕获 SSE 错误并保留正文，不重试', async (errorEvent) => {
    const stream = startStream();
    const raw = '{"walls":[' + JSON.stringify(WALL);
    stream.send(event(raw) + errorEvent);
    expect(await stream.outcome).toMatchObject({ raw, message: expect.stringContaining('provider unavailable') });
    expect(stream.progress.at(-1)?.partial?.walls).toHaveLength(1);
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it('拒绝不完整 SSE 帧、损坏的事件与非有限数值', async () => {
    const stream = startStream();
    stream.send(event(PLAN) + 'data: {"choices":');
    stream.end();
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('事件结束前中断') });
    const invalid = startStream();
    invalid.send('data: not-json\n\n');
    expect(await invalid.outcome).toMatchObject({ message: expect.stringContaining('无法解析的流式事件') });
    const infinite = startStream();
    infinite.send(event(PLAN.replace('2.8', '1e400')) + 'data: [DONE]\n\n');
    expect(await infinite.outcome).toMatchObject({ message: expect.stringContaining('完整合法') });
  });

  it('EOF 截断 UTF-8 使用解码错误，不误报网络或重试', async () => {
    const stream = startStream();
    stream.send(event(PLAN));
    stream.send(Uint8Array.of(0xe6, 0x88));
    stream.end();
    expect(await stream.outcome).toMatchObject({ raw: PLAN, message: expect.stringContaining('UTF-8') });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it('只有说明文字或尾逗号的最终正文不使用宽松 JSON 修复', async () => {
    const raw = PLAN.replace('"furniture":[]', '"furniture":[],');
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse(raw));
    vi.stubGlobal('fetch', fetchMock);
    await expect(recognizeFloorPlan(CONFIG, IMAGE)).rejects.toMatchObject({ raw, message: expect.stringContaining('完整合法') });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('代理 fetch 也失败时不再尝试第三次请求', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(recognizeFloorPlan(CONFIG, IMAGE)).rejects.toThrow('网络连接中断');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('拒绝无效 UTF-8，不通过网络回退重新识别', async () => {
    const stream = startStream();
    stream.send(Uint8Array.of(0xff));
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('UTF-8') });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it('请求前取消不访问网络', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(recognizeFloorPlan(CONFIG, IMAGE, { signal: controller.signal })).rejects.toThrow('取消');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('connecting 回调中取消不会发送请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(recognizeFloorPlan(CONFIG, IMAGE, {
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toThrow('取消');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('流中取消能中断挂起的 read，释放 reader、信号监听与全部计时器', async () => {
    vi.useFakeTimers();
    const stream = streamHarness();
    const fetchMock = vi.fn().mockResolvedValue(stream.response);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = recognizeFloorPlan(CONFIG, IMAGE, { signal: controller.signal }).catch((error: unknown) => error);
    stream.send(event('{"walls":['));
    await settle();
    controller.abort();
    expect(await result).toMatchObject({ message: '识别已取消。', raw: '{"walls":[' });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('等待 headers 时取消不回退代理，即使 fetch 忽略 abort', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = recognizeFloorPlan(CONFIG, IMAGE, { signal: controller.signal }).catch((error: unknown) => error);
    controller.abort();
    expect(await result).toMatchObject({ message: '识别已取消。' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('仅直连 fetch 网络失败时回退原代理，connecting 报告实际传输方式', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(bufferedResponse());
    vi.stubGlobal('fetch', fetchMock);
    const progress: RecognitionProgress[] = [];
    await recognizeFloorPlan(CONFIG, IMAGE, { onProgress: (value) => progress.push(value) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/functions/v1/app');
    const proxyBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(proxyBody).toMatchObject({ baseUrl: CONFIG.baseUrl, apiKey: CONFIG.apiKey, payload: { stream: true } });
    expect(progress.filter((value) => value.phase === 'connecting').map((value) => value.transport)).toEqual(['direct', 'proxy']);
    expect(progress.at(-1)).toMatchObject({ transport: 'proxy', buffered: true });
  });

  it('HTTP 拒绝不走代理；流中网络中断也不走代理', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"unauthorized"}}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(recognizeFloorPlan(CONFIG, IMAGE)).rejects.toThrow('API Key');
    expect(fetchMock).toHaveBeenCalledOnce();
    const stream = startStream();
    stream.send(event('{"walls":['));
    await settle();
    stream.fail();
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('网络连接中断'), raw: '{"walls":[' });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });

  it('首字节 90 秒超时终止 fetch，不回退或重试', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const result = recognizeFloorPlan(CONFIG, IMAGE).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toMatchObject({ message: expect.stringContaining('首个响应超过 90 秒') });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('已收到 headers 但没有首字节也受 90 秒限制', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    await settle();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('90 秒') });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('正文空闲 60 秒超时中断 read，非流式 JSON 读取同样受限', async () => {
    vi.useFakeTimers();
    const stream = startStream('application/json');
    stream.send('{"choices":[');
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('60 秒未返回数据') });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('持续 keepalive 不能绕过总计 240 秒期限', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    stream.send(': ping\n\n');
    await settle();
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(50_000);
      stream.send(': ping\n\n');
      await settle();
    }
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('总时长超过 240 秒') });
    expect(stream.progress).toHaveLength(1);
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['x', '测'])('正文仍按 UTF-8 字节限制在 1MB（%s）', async (character) => {
    const stream = startStream();
    const text = character.repeat(Math.floor(1024 * 1024 / encoder.encode(character).byteLength) + 1);
    stream.send(event(text));
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('1MB'), raw: '' });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it('没有换行的单条事件仍限制在 2MB', async () => {
    const stream = startStream();
    stream.send(':'.repeat(2 * 1024 * 1024 + 1));
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('单条流式事件超过 2MB') });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });

  it.each(['unterminated-line', 'multiline-data'])('拆分读取或多行 data 不能绕过单条事件上限（%s）', async (mode) => {
    const stream = startStream();
    const prefix = 'data: ';
    stream.send(prefix + 'x'.repeat(1024 * 1024));
    await settle();
    expect(stream.cancel).not.toHaveBeenCalled();
    stream.send((mode === 'multiline-data' ? '\ndata: ' : '') + 'x'.repeat(1024 * 1024));
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('单条流式事件超过 2MB'), raw: '' });
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it.each(['application/json', 'text/plain'])('整包与未知格式响应保持 2MB 缓冲限制（%s）', async (contentType) => {
    const stream = startStream(contentType);
    stream.send('x'.repeat(1024 * 1024));
    await settle();
    expect(stream.cancel).not.toHaveBeenCalled();
    stream.send('x'.repeat(1024 * 1024 + 1));
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('整包或未知格式响应超过 2MB'), raw: '' });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.fetchMock).toHaveBeenCalledOnce();
  });

  it('HTTP 错误响应不能绕过 2MB 缓冲限制', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1), {
      status: 502, headers: { 'Content-Type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(recognizeFloorPlan(CONFIG, IMAGE)).rejects.toMatchObject({
      message: expect.stringContaining('整包或未知格式响应超过 2MB'), raw: '',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('丢弃的 keepalive 仍受 32MB 总传输量限制并释放计时器', async () => {
    vi.useFakeTimers();
    const stream = startStream();
    const megabyte = (':' + 'x'.repeat(1021) + '\n\n').repeat(1024);
    expect(encoder.encode(megabyte).byteLength).toBe(1024 * 1024);
    for (let index = 0; index < 32; index += 1) {
      stream.send(megabyte);
      await settle();
      expect(stream.cancel).not.toHaveBeenCalled();
    }
    stream.send(megabyte);
    expect(await stream.outcome).toMatchObject({ message: expect.stringContaining('总传输量超过 32MB'), raw: '' });
    expect(stream.progress).toHaveLength(1);
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function imageBrowser(width: number, height: number, compressed = 'data:image/jpeg;base64,AA==', broken = false) {
  const revoke = vi.fn();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  const images: FakeImage[] = [];
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    value = '';
    constructor() { images.push(this); }
    set src(value: string) {
      this.value = value;
      if (value) queueMicrotask(() => broken ? this.onerror?.() : this.onload?.());
    }
    get src() { return this.value; }
  }
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: vi.fn().mockReturnValue(context), toDataURL: vi.fn().mockReturnValue(compressed) };
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(canvas) });
  class FakeReader {
    result = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    readAsDataURL(file: File) {
      this.result = `data:${file.type};base64,` + 'A'.repeat(Math.ceil(file.size / 3) * 4);
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('FileReader', FakeReader);
  return { canvas, context, images, revoke };
}

describe('图片准备与连接测试兼容性', () => {
  it.each([
    [4000, 3000, 2048, 1536], [3000, 4000, 1536, 2048], [1000, 700, 1000, 700],
    [2048, 2048, 2048, 2048], [100_000, 1, 2048, 1],
  ])('保持比例、不放大：%s × %s → %s × %s', (width, height, targetWidth, targetHeight) => {
    expect(imageTargetDimensions(width, height)).toEqual({ width: targetWidth, height: targetHeight });
  });

  it('无效尺寸返回可读错误', () => {
    expect(() => imageTargetDimensions(0, 100)).toThrow('图片尺寸无效');
    expect(() => imageTargetDimensions(Infinity, 100)).toThrow('图片尺寸无效');
  });

  it('大尺寸图片即使原始文件更小也必须缩小，白底 JPEG 0.9，释放资源', async () => {
    const compressed = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
    const browser = imageBrowser(4000, 3000, compressed);
    const file = new File(['x'], 'large.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe(compressed);
    expect(browser.context.fillStyle).toBe('#ffffff');
    expect(browser.context.fillRect).toHaveBeenCalledWith(0, 0, 2048, 1536);
    expect(browser.context.drawImage).toHaveBeenCalledWith(browser.images[0], 0, 0, 2048, 1536);
    expect(browser.canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
    expect(browser.canvas.width).toBe(0);
    expect(browser.canvas.height).toBe(0);
    expect(browser.images[0].src).toBe('');
    expect(browser.images[0].onload).toBeNull();
    expect(browser.revoke).toHaveBeenCalledWith('blob:test-image');
  });

  it('小图片仍实际解码，但无需重编码', async () => {
    const browser = imageBrowser(20, 10);
    expect(await fileToDataUrl(new File(['x'], 'small.png', { type: 'image/png' }))).toBe('data:image/png;base64,AAAA');
    expect(browser.images).toHaveLength(1);
    expect(browser.canvas.toDataURL).not.toHaveBeenCalled();
    expect(browser.revoke).toHaveBeenCalledOnce();
  });

  it('尺寸已经合规时选择更小编码，不放大', async () => {
    const browser = imageBrowser(1200, 800);
    const file = new File([new Uint8Array(70_000)], 'image.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe('data:image/jpeg;base64,AA==');
    expect(browser.context.drawImage).toHaveBeenCalledWith(browser.images[0], 0, 0, 1200, 800);
    browser.canvas.toDataURL.mockReturnValue('data:image/jpeg;base64,' + 'B'.repeat(100_000));
    const original = await fileToDataUrl(file);
    expect(original.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('损坏图片与 canvas 错误可读，所有分支释放 object URL', async () => {
    const browser = imageBrowser(0, 0, undefined, true);
    await expect(fileToDataUrl(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }))).rejects.toThrow('图片解码失败');
    expect(browser.revoke).toHaveBeenCalledOnce();
    expect(browser.images[0].onerror).toBeNull();
    const missing = imageBrowser(4000, 2000);
    missing.canvas.getContext.mockReturnValue(null);
    await expect(fileToDataUrl(new File(['x'], 'bad.jpg', { type: 'image/jpeg' }))).rejects.toThrow('浏览器无法处理图片');
    expect(missing.canvas.width).toBe(0);
    expect(missing.revoke).toHaveBeenCalledOnce();
  });

  it('保留 10MB 文件限制', () => {
    expect(validateImageFile(new File([new Uint8Array(10 * 1024 * 1024)], 'ok.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateImageFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))).toContain('10MB');
  });

  it('DeepSeek 连接测试关闭思考，不再发送无效的 effort 字段', async () => {
    imageBrowser(8, 8);
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse('OK'));
    vi.stubGlobal('fetch', fetchMock);
    expect((await testConnection({ ...CONFIG, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' })).ok).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ stream: false, thinking: { type: 'disabled' } });
    expect(payload).not.toHaveProperty('effort');
    expect(payload).not.toHaveProperty('reasoning_effort');
  });

  it.each(['deepseek-flash', 'deepseek-v4.1-flash'])('百炼连接测试与识别共用模型匹配并关闭思考（%s）', async (model) => {
    imageBrowser(8, 8);
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse('OK'));
    vi.stubGlobal('fetch', fetchMock);
    const config = { ...CONFIG, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model };
    expect((await testConnection(config)).ok).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ model: 'deepseek-v4.1-flash', stream: false, max_tokens: 1024, enable_thinking: false });
    for (const field of ['thinking', 'thinking_budget', 'reasoning_effort', 'extra_body', 'effort']) expect(payload).not.toHaveProperty(field);
    expect(fetchMock.mock.calls[0][0]).toBe(`${config.baseUrl}/chat/completions`);
  });

  it('testConnection 保持非流式 JSON OK 协议', async () => {
    imageBrowser(8, 8);
    const fetchMock = vi.fn().mockResolvedValue(bufferedResponse('OK'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await testConnection(CONFIG)).toEqual({ ok: true, message: '连接成功，模型支持图像输入。' });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ stream: false, max_tokens: 8 });
  });
});