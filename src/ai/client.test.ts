import { describe, expect, it } from 'vitest';
import { RecognitionError, parseModelJson } from './client';

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