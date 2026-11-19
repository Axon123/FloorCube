import { describe, expect, it, vi } from 'vitest';
import { RecognitionError, parseModelJson, recognizeFloorPlan } from './client';

const PLAN = '{"version":1,"name":"测试","unit":"m","wallHeight":2.8,"walls":[{"id":"w1","start":[0,0],"end":[4,0],"thickness":0.24,"confidence":0.9}],"openings":[],"rooms":[{"id":"r1","name":"客厅","type":"living","polygon":[[0,0],[4,0],[4,3],[0,3]],"confidence":0.9}],"furniture":[]}';

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
    } finally {
      vi.unstubAllGlobals();
    }
  });
});