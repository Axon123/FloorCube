import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const fixture = {
  version: 1, name: '原有方案', unit: 'm', scaleSource: 'annotation', wallHeight: 2.8,
  walls: [
    { id: 'w1', start: [0, 0], end: [8, 0], thickness: .24 },
    { id: 'w2', start: [8, 0], end: [8, 6], thickness: .24 },
    { id: 'w3', start: [8, 6], end: [0, 6], thickness: .24 },
    { id: 'w4', start: [0, 6], end: [0, 0], thickness: .24 },
  ],
  rooms: [{ id: 'r1', name: '原客厅', type: 'living', polygon: [[0, 0], [8, 0], [8, 6], [0, 6]], confidence: .9 }],
  openings: [], furniture: [],
};
const result = structuredClone(fixture);
result.name = '流式识别测试';
result.rooms[0].name = '客厅 <img src=x onerror=alert(1)>';
result.openings = [{ id: 'o1', wallId: 'w1', type: 'window', offset: 2, width: 1.2, height: 1.2, sillHeight: .9 }];
result.furniture = [{ id: 'f1', model: 'desk', roomId: 'r1', position: [4, 3], rotation: 0, color: 'oak' }];
const prefix = '{"version":1,"name":"流式识别测试","unit":"m","wallHeight":2.8,"walls":[' + JSON.stringify(result.walls[0]);
const middle = ',' + result.walls.slice(1).map((wall) => JSON.stringify(wall)).join(',') + '],"rooms":[' + JSON.stringify(result.rooms[0]);
const suffix = '],"openings":' + JSON.stringify(result.openings) + ',"furniture":' + JSON.stringify(result.furniture) + '}';
const errors = [];
const blockedRequests = [];
const appUrl = 'http://127.0.0.1:5173/';
let page;

// null starts unconfigured; the mock still permits only one explicitly chosen endpoint.
async function makePage(mobile = false, modelConfig = {}, mockBaseUrl = modelConfig?.baseUrl ?? `${appUrl}__recognition-test`) {
  const config = modelConfig === null ? null : { baseUrl: `${appUrl}__recognition-test`, model: 'qwen-vl-max', ...modelConfig, apiKey: 'test-only' };
  const endpoint = `${mockBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const next = await browser.newPage();
  next.setDefaultTimeout(30_000);
  next.on('pageerror', (error) => errors.push(error.message));
  await next.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 1000 });
  // Fail closed: even a missed mock, proxy retry or non-fetch request cannot reach a model.
  await next.setRequestInterception(true);
  next.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && (
      url.origin !== new URL(appUrl).origin || !['GET', 'HEAD'].includes(request.method()) ||
      /\/chat\/completions\/?$|^\/functions\//.test(url.pathname)
    )) {
      blockedRequests.push(`${request.method()} ${request.url()}`);
      void request.abort('blockedbyclient');
    } else {
      void request.continue();
    }
  });
  await next.exposeFunction('__reportUnmockedFetch', (url) => { blockedRequests.push(url); });
  await next.evaluateOnNewDocument((original, config, endpoint) => {
    localStorage.setItem('floorcube.onboarded', '1');
    localStorage.setItem('floorcube.autosave', JSON.stringify(original));
    if (config) localStorage.setItem('floorcube.model-config', JSON.stringify(config));
    else localStorage.removeItem('floorcube.model-config');
    const nativeFetch = window.fetch.bind(window);
    window.__requests = [];
    window.__mode = 'sse';
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.href !== endpoint) {
        if (url.origin === location.origin && ['GET', 'HEAD'].includes(method) &&
            !/\/chat\/completions\/?$|^\/functions\//.test(url.pathname)) return nativeFetch(input, init);
        await window.__reportUnmockedFetch(`${method} ${url.href}`);
        throw new Error(`Unmocked model/proxy fetch blocked: ${url.href}`);
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const request = {
        url: url.href, method, authorization: headers.get('Authorization'),
        signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
        body: JSON.parse(init?.body ?? await input.clone().text()), cancelled: false,
      };
      window.__requests.push(request);
      if (request.body.stream === false) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const stream = new ReadableStream({
        start(controller) { request.controller = controller; },
        cancel() { request.cancelled = true; },
      });
      return new Response(stream, { headers: { 'Content-Type': window.__mode === 'sse' ? 'text/event-stream' : 'application/json' } });
    };
    window.__push = (text) => window.__requests.at(-1).controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + '\r\n\r\n'));
    window.__finish = () => {
      const controller = window.__requests.at(-1).controller;
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    };
  }, fixture, config, endpoint);
  await next.goto(appUrl, { waitUntil: 'networkidle0' });
  await next.evaluate(async () => {
    window.__originalWorkspace = localStorage.getItem('floorcube.autosave');
    const sceneModule = performance.getEntriesByType('resource').findLast((entry) => new URL(entry.name).pathname === '/src/scene/FloorScene.ts');
    const { FloorScene } = await import(sceneModule.name);
    const rebuild = FloorScene.prototype.rebuild;
    FloorScene.prototype.rebuild = function (...args) {
      const value = rebuild.apply(this, args);
      if (this.container.id === 'recognition-scene') window.__scene = this;
      return value;
    };
    const reset = FloorScene.prototype.resetCamera;
    window.__resets = 0;
    FloorScene.prototype.resetCamera = function (...args) {
      if (this.container.id === 'recognition-scene') window.__resets++;
      return reset.apply(this, args);
    };
  });
  return next;
}

async function sendImage(source = 'file') {
  await page.evaluate(async (source) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 4000, 3000);
    context.strokeStyle = '#222';
    context.lineWidth = 14;
    context.strokeRect(300, 300, 3200, 2400);
    context.fillStyle = '#222';
    context.font = '80px sans-serif';
    context.fillText('8000 mm', 1500, 220);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    window.__testImageFile = new File([blob], '户型测试.png', { type: 'image/png' });
    transfer.items.add(window.__testImageFile);
    if (source === 'paste') {
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    } else {
      const input = document.querySelector('#file-input');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, source);
}

async function assertUploadReady() {
  await page.waitForFunction(() => document.querySelector('#upload-recognize')?.disabled === false && document.querySelector('#upload-preview')?.complete);
  assert.equal(await page.$eval('#upload-preview', (image) => image.naturalWidth), 2048);
}

async function upload(source = 'file', autoStart = true) {
  await page.click('#upload-button');
  await page.evaluate(() => { window.__uploadDialog = document.querySelector('#upload-zone').closest('.modal-overlay'); });
  await sendImage(source);
  assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 1, 'upload must reuse the existing dialog');
  assert.equal(await page.evaluate(() => document.querySelector('#upload-zone').closest('.modal-overlay') === window.__uploadDialog), true);
  await assertUploadReady();
  if (autoStart) await start();
}

const settleUI = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function start() {
  const count = await page.evaluate(() => {
    // A disposed preview can still contain the same fixture as the next request.
    window.__scene = null;
    return window.__requests.length;
  });
  await page.click('#upload-recognize');
  await page.waitForFunction((previous) => window.__requests.length > previous, {}, count);
  await settleUI();
  assert.equal(await page.evaluate(() => window.__requests.length), count + 1, 'one click must start exactly one request');
}
const push = (text) => page.evaluate((value) => window.__push(value), text);
const waitCount = (key, count) => page.waitForFunction((key, count) => document.querySelector(`[data-count="${key}"]`)?.textContent === String(count), {}, key, count);
const originalIntact = async () => {
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('floorcube.autosave')).name), '原有方案');
  assert.equal(await page.evaluate(() => localStorage.getItem('floorcube.autosave') === window.__originalWorkspace), true, 'the entire original workspace must remain unchanged');
};
const pose = () => page.evaluate(() => {
  const scene = window.__scene;
  return {
    offset: scene.camera.position.clone().sub(scene.controls.target).toArray(),
    quaternion: scene.camera.quaternion.toArray(),
    point: scene.world([0, 0]).project(scene.camera).toArray(), resets: window.__resets,
  };
});

const modeRadio = (mode) => `input[name="recognition-mode"][value="${mode}"]`;
const modeName = (mode) => mode === 'fast' ? '快速' : '精细';

async function assertModeControls(selected, locked = false) {
  await page.waitForSelector('#recognition-mode-options', { visible: true });
  await page.waitForSelector('#recognition-mode-hint', { visible: true });
  await page.waitForFunction((locked) => document.querySelector('#recognition-mode-options').disabled === locked, {}, locked);
  assert.equal(await page.$eval('#recognition-mode-options', (element) => element.tagName), 'FIELDSET');
  assert.deepEqual(await page.$$eval('input[name="recognition-mode"]', (elements) => elements.map((element) => ({
    value: element.value, type: element.type, checked: element.checked, disabled: element.matches(':disabled'),
    inFieldset: element.closest('fieldset')?.id === 'recognition-mode-options',
  })).sort((a, b) => a.value.localeCompare(b.value))), ['detailed', 'fast'].map((value) => ({
    value, type: 'radio', checked: value === selected, disabled: locked, inFieldset: true,
  })));
}

async function assertTransferMode(mode) {
  const label = `${modeName(mode)}模式`;
  await page.waitForFunction((label) => document.querySelector('#recognition-transfer').textContent.includes(label), {}, label);
  assert.ok(!(await page.$eval('#recognition-transfer', (element) => element.textContent)).includes(`${modeName(mode === 'fast' ? 'detailed' : 'fast')}模式`));
}

const modeSnapshot = () => page.evaluate(() => ({
  requests: window.__requests.length,
  image: document.querySelector('#upload-preview').getAttribute('src'),
  imageInfo: document.querySelector('#upload-image-info').textContent,
  counts: document.querySelector('#recognition-counts').textContent,
  status: document.querySelector('#scan-title').textContent,
  transfer: document.querySelector('#recognition-progress').classList.contains('hidden') ? null : document.querySelector('#recognition-transfer').textContent,
  previewTitle: document.querySelector('#recognition-preview-title').textContent,
  previewNote: document.querySelector('#recognition-preview-note').textContent,
  previewHidden: document.querySelector('#recognition-preview').classList.contains('hidden'),
  planImage: document.querySelector('#recognition-plan-image').getAttribute('src'),
  scenePlan: window.__scene?.container.isConnected ? JSON.stringify(window.__scene.store.plan) : null,
  canvases: document.querySelectorAll('#recognition-scene canvas').length,
  applyHidden: document.querySelector('#upload-apply').classList.contains('hidden'),
  partialHidden: document.querySelector('#upload-partial').classList.contains('hidden'),
  recognizeDisabled: document.querySelector('#upload-recognize').disabled,
  workspace: localStorage.getItem('floorcube.autosave'),
  modelConfig: localStorage.getItem('floorcube.model-config'),
  workspaceRooms: [...document.querySelectorAll('.room-row')].map((element) => element.textContent),
}));

async function switchMode(mode, touch = false) {
  const before = await modeSnapshot();
  if (touch) await page.tap(modeRadio(mode));
  else await page.click(modeRadio(mode));
  await settleUI();
  await assertModeControls(mode);
  assert.deepEqual(await modeSnapshot(), before, 'changing mode alone must not send, clear, relabel or apply a result');
}

async function cancelRecognition() {
  await page.click('#upload-cancel');
  await page.waitForFunction(() => document.querySelector('#scan-title').textContent === '已停止识别');
  await page.waitForFunction(() => window.__requests.at(-1).signal.aborted && window.__requests.at(-1).cancelled);
}

const lastRequest = () => page.evaluate(() => {
  const { url, method, authorization, body } = window.__requests.at(-1);
  return { url, method, authorization, body };
});

function assertBailianParameters(body, mode, connection = false) {
  assert.equal(body.enable_thinking, mode === 'detailed');
  assert.equal(body.max_tokens, connection ? 1024 : mode === 'fast' ? 8192 : 32768);
  if (mode === 'fast') assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  else assert.equal(body.reasoning_effort, 'high');
  for (const field of ['thinking', 'thinking_budget', 'extra_body', 'effort', 'provider']) {
    assert.equal(Object.hasOwn(body, field), false, `Bailian Flash must not receive ${field}`);
  }
}

async function assertBailianHint(mode) {
  await page.waitForSelector('#recognition-mode-hint', { visible: true });
  const hint = await page.$eval('#recognition-mode-hint', (element) => element.textContent);
  assert.match(hint, /百炼/);
  assert.ok(hint.includes(bailianModel), 'hint must name the actual Bailian request model');
  assert.match(hint, mode === 'fast' ? /关闭思考/ : /开启思考/);
  assert.doesNotMatch(hint, /仅调整识别侧重点/);
}

async function assertModeRequest(config, mode, native = false, requestModel = config.model) {
  const request = await lastRequest();
  assert.equal(request.url, `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`);
  assert.equal(request.method, 'POST');
  assert.equal(request.authorization, 'Bearer test-only');
  assert.equal(request.body.model, requestModel);
  assert.equal(request.body.stream, true);
  const body = request.body;
  assert.equal(Object.hasOwn(body, 'effort'), false);
  if (native === 'bailian') {
    assertBailianParameters(body, mode);
  } else if (native) {
    assert.deepEqual(body.thinking, { type: mode === 'fast' ? 'disabled' : 'enabled' });
    assert.equal(body.max_tokens, mode === 'fast' ? 8192 : 32768);
    if (mode === 'fast') assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
    else assert.equal(body.reasoning_effort, 'high');
    for (const field of ['enable_thinking', 'thinking_budget', 'extra_body', 'provider']) {
      assert.equal(Object.hasOwn(body, field), false, `DeepSeek official must not receive ${field}`);
    }
  } else {
    for (const field of ['thinking', 'reasoning_effort', 'enable_thinking', 'thinking_budget', 'extra_body', 'provider']) {
      assert.equal(Object.hasOwn(body, field), false, `unsupported model must not receive ${field}`);
    }
    const prompt = body.messages.flatMap((message) => typeof message.content === 'string' ? [message.content] :
      message.content.filter((part) => part.type === 'text').map((part) => part.text)).join('\n');
    assert.ok(prompt.includes(`识别模式：${modeName(mode)}`), 'prompt must explain the selected recognition focus');
    assert.ok(!prompt.includes(`识别模式：${modeName(mode === 'fast' ? 'detailed' : 'fast')}`));
  }
  return body;
}

function requestImage(body) {
  const images = body.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url') : []);
  assert.equal(images.length, 1);
  assert.match(images[0].image_url.url, /^data:image\//);
  return images[0];
}

async function assertMobileModeLayout() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'mobile page must not overflow horizontally');
  for (const selector of ['.modal', '#recognition-mode-options']) {
    assert.equal(await page.$eval(selector, (element) => element.scrollWidth > element.clientWidth + 1), false, `${selector} must fit on mobile`);
  }
  assert.equal(await page.$$eval('input[name="recognition-mode"]', (elements) => elements.every((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
  })), true, 'both native radio inputs must remain reachable on mobile');
}

const deepseekUrl = 'https://api.deepseek.com';
const bailianUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const maasUrl = 'https://test-only.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/';
const bailianModel = 'deepseek-v4.1-flash';
// Explicit fixtures, not the production host matcher, define the expected adaptation.
const bailianConfigs = [
  { baseUrl: bailianUrl, model: 'deepseek-flash' },
  { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
  { baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
  { baseUrl: maasUrl, model: 'deepseek-flash' },
  { baseUrl: bailianUrl, model: bailianModel },
  { baseUrl: maasUrl, model: bailianModel },
];
const storedConfig = () => page.evaluate(() => localStorage.getItem('floorcube.model-config'));
const requestCount = () => page.evaluate(() => window.__requests.length);
const singleOverlay = async () => assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 1);

async function openConfig() {
  await page.click('#config-button');
  await page.waitForSelector('#cfg-model-preset', { visible: true });
  await singleOverlay();
}

async function fillConfig(values, inputOnly = false) {
  await page.evaluate((values, inputOnly) => {
    for (const [name, value] of Object.entries(values)) {
      const input = document.querySelector(`#cfg-${name}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (!inputOnly) input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, values, inputOnly);
}

async function assertRequestModel(model) {
  await page.waitForSelector('#cfg-model-request', { visible: true });
  assert.equal(await page.$eval('#cfg-model-request', (element) => element.tagName), 'P');
  assert.equal(await page.$eval('#cfg-model-request', (element) => element.textContent.replace(/\s+/g, '')), `请求模型：${model}`);
}

async function assertConfig(overrides = {}) {
  const expected = { preset: 'deepseek-flash', provider: deepseekUrl, model: '', url: '', key: '', ...overrides };
  await settleUI();
  const state = await page.evaluate(() => {
    const value = (id) => document.querySelector(id).value;
    const visible = (id) => document.querySelector(id).getClientRects().length > 0;
    return {
      fields: { preset: value('#cfg-model-preset'), provider: value('#cfg-provider'), model: value('#cfg-model'), url: value('#cfg-url'), key: value('#cfg-key') },
      modelVisible: visible('#cfg-model-custom') && visible('#cfg-model'),
      urlVisible: visible('#cfg-url-custom') && visible('#cfg-url'), presetVisible: visible('#cfg-url-preset'),
      presetUrl: document.querySelector('#cfg-url-preset').textContent,
    };
  });
  assert.deepEqual(state.fields, expected);
  assert.equal(state.modelVisible, expected.preset === 'custom');
  assert.equal(state.urlVisible, expected.provider === 'custom');
  assert.equal(state.presetVisible, expected.provider !== 'custom');
  if (expected.provider !== 'custom') assert.ok(state.presetUrl.includes(expected.provider), 'show the selected official URL');
}

async function saveConfig(expected) {
  const count = await requestCount();
  await page.click('#cfg-save');
  await page.waitForFunction(() => !document.querySelector('#cfg-save'));
  assert.deepEqual(JSON.parse(await storedConfig()), expected, 'persist only actual baseUrl, apiKey and model strings');
  assert.equal(await requestCount(), count, 'saving must not send a request');
}

async function rejectConfig(message) {
  const before = await storedConfig();
  const count = await requestCount();
  for (const button of ['#cfg-save', '#cfg-test']) {
    await page.click(button);
    await page.waitForSelector('#cfg-result.error:not(.hidden)');
    assert.match(await page.$eval('#cfg-result', (element) => element.textContent), message);
    await singleOverlay();
    assert.equal(await storedConfig(), before, 'invalid configuration must not overwrite storage');
    assert.equal(await requestCount(), count, 'invalid configuration must not call the API');
  }
}

async function testConfigConnection(config, requestModel = config.model, native = false) {
  const before = await storedConfig();
  const count = await requestCount();
  await page.click('#cfg-test');
  await page.waitForFunction(() => document.querySelector('#cfg-result')?.textContent.includes('连接成功'));
  assert.equal(await requestCount(), count + 1);
  const { body, ...request } = await lastRequest();
  assert.deepEqual(request, { url: `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, method: 'POST', authorization: 'Bearer test-only' });
  assert.equal(body.model, requestModel);
  assert.equal(body.stream, false);
  if (native === 'bailian') {
    assertBailianParameters(body, 'fast', true);
  } else {
    for (const field of ['enable_thinking', 'reasoning_effort', 'thinking_budget', 'extra_body', 'effort', 'provider']) {
      assert.equal(Object.hasOwn(body, field), false, `non-Bailian connection must not receive ${field}`);
    }
    if (native) {
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.max_tokens, 1024);
    } else {
      assert.equal(Object.hasOwn(body, 'thinking'), false);
      assert.equal(body.max_tokens, /deepseek/i.test(config.model) || /deepseek/i.test(config.baseUrl) ? 1024 : 8);
    }
  }
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Reply with OK only.' });
  assert.equal(body.messages[1].role, 'user');
  assert.ok(body.messages[1].content.some((part) => part.type === 'text' && part.text.includes('OK')));
  assert.match(requestImage(body).image_url.url, /^data:image\/png;base64,/);
  assert.equal(await storedConfig(), before, 'testing a draft must not save it');
}

async function assertConfigLayout() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'config page must not overflow horizontally');
  assert.equal(await page.$$eval('.modal, #cfg-model-preset, #cfg-provider, #cfg-model-custom, #cfg-url-custom, #cfg-url-preset, #cfg-model-request, #cfg-key, #cfg-save, #cfg-test, #cfg-clear', (elements) => elements.every((element) => {
    if (!element.getClientRects().length) return true;
    const rect = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth + 1 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
  })), true, 'configuration fields and actions must fit within the viewport');
}

try {
  page = await makePage();
  await upload('paste');
  assert.equal(await page.evaluate(() => window.__requests[0].body.stream), true);
  const reasoningBytes = await page.evaluate(async () => {
    const encoder = new TextEncoder();
    const packet = 'data: ' + JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion.chunk', model: 'test-vision',
      provider_metadata: { trace: 'x'.repeat(256) },
      choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '测试推理片段', content: null } }],
    }) + '\r\n\r\n';
    const batch = encoder.encode(packet.repeat(100));
    for (let index = 0; index < 60; index += 1) {
      window.__requests.at(-1).controller.enqueue(batch);
      await new Promise(requestAnimationFrame);
    }
    return batch.byteLength * 60;
  });
  assert.ok(reasoningBytes > 2 * 1024 * 1024);
  assert.equal(await page.evaluate(() => window.__requests[0].signal.aborted), false);
  assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
  assert.match(await page.$eval('#recognition-transfer', (element) => element.textContent), /0 字符/);
  assert.equal(await page.$eval('.modal', (element) => element.textContent.includes('测试推理片段')), false);
  console.log('PASS over 2MB of reasoning and protocol traffic does not abort or invent results');
  await push(prefix);
  await waitCount('walls', 1);
  await page.waitForSelector('#recognition-scene canvas');
  assert.equal(await page.$eval('[data-count="rooms"]', (element) => element.textContent), '0');
  await page.mouse.click(5, 5);
  assert.ok(await page.$('#upload-zone'));
  assert.equal(await page.evaluate(() => window.__requests.at(-1).signal.aborted), false);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(window.__testImageFile);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    document.querySelector('#upload-button').click();
  });
  assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 1);
  assert.equal(await page.evaluate(() => document.querySelector('#upload-zone').closest('.modal-overlay') === window.__uploadDialog), true);
  assert.equal(await page.evaluate(() => window.__requests.length), 1);
  assert.equal(await page.evaluate(() => window.__requests[0].signal.aborted), false);
  assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '1');
  console.log('PASS paste reuses the upload dialog and cannot interrupt active recognition');
  console.log('PASS first streamed wall and backdrop protection');

  const box = await page.$eval('#recognition-scene canvas', (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .72, box.y + box.height * .53, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const current = window.__scene.camera.position.toArray();
    const previous = window.__stablePosition;
    window.__stablePosition = current;
    const stable = previous && current.every((value, index) => Math.abs(value - previous[index]) < .00001);
    window.__stableFrames = stable ? (window.__stableFrames || 0) + 1 : 0;
    return window.__stableFrames >= 4;
  }, { polling: 'raf' });
  const before = await pose();
  await push(middle);
  await waitCount('rooms', 1);
  await page.waitForFunction(() => window.__scene.store.plan.rooms.length === 1);
  const after = await pose();
  assert.equal(after.resets, before.resets);
  for (const key of ['offset', 'quaternion', 'point']) before[key].forEach((value, index) => assert.ok(Math.abs(value - after[key][index]) < .001, `${key} changed: ${value} -> ${after[key][index]}`));
  await originalIntact();
  await page.click('#recognition-fit');
  assert.equal(await page.evaluate(() => window.__resets), before.resets + 1);
  await page.click('[data-preview-view="2d"]');
  await page.waitForFunction(() => document.querySelector('#recognition-plan-image').complete);
  assert.equal(await page.$eval('#recognition-plan-image', (image) => image.clientHeight === image.parentElement.clientHeight), true);
  await page.screenshot({ path: fileURLToPath(new URL('../screenshots/2026-11-20-streaming-progress.png', import.meta.url)) });
  await page.click('[data-preview-view="3d"]');
  console.log('PASS growing geometry preserves orbit, pan and zoom');

  await push(suffix);
  await page.evaluate(() => window.__finish());
  await page.waitForSelector('#upload-apply:not(.hidden)');
  assert.ok(await page.$('#upload-zone'));
  assert.equal(await page.$eval('#scan-title', (element) => element.textContent), '识别完成，等待确认');
  await originalIntact();
  await waitCount('furniture', 1);
  assert.equal(await page.evaluate(() => window.__scene.store.plan.furniture.length), 1);
  assert.equal(await page.$eval('#upload-apply', (button) => {
    const rect = button.getBoundingClientRect();
    const modal = button.closest('.modal').getBoundingClientRect();
    return rect.top >= modal.top && rect.bottom <= modal.bottom && rect.bottom <= window.innerHeight;
  }), true, 'apply must remain visible without scrolling past the mode controls');
  await page.screenshot({ path: fileURLToPath(new URL('../screenshots/2026-11-20-streaming-ready.png', import.meta.url)) });
  await page.click('#upload-apply');
  await page.waitForFunction(() => !document.querySelector('#upload-zone'));
  assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('floorcube.autosave')).name === '流式识别测试');
  assert.equal(await page.$$eval('.room-label img', (elements) => elements.length), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('floorcube.autosave')).furniture.length), 1);
  assert.equal(await page.$eval('[data-view="split"]', (button) => button.classList.contains('active')), true);
  await page.click('[data-view="2d"]');
  assert.equal(await page.$eval('[data-view="2d"]', (button) => button.classList.contains('active')), true);
  console.log('PASS apply closes every upload overlay and returns to an interactive workspace');
  console.log('PASS explicit confirmation, safe room names and furniture application');
  await upload();
  assert.equal(await page.evaluate(() => window.__requests.length), 2);
  assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
  await page.click('.modal-close');
  await page.waitForFunction(() => window.__requests.at(-1).signal.aborted && window.__requests.at(-1).cancelled);
  assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('floorcube.autosave')).name), '流式识别测试');
  console.log('PASS reopening after apply starts a fresh upload without stale dialogs or listeners');
  await page.close();

  for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/v1']) {
    const config = { baseUrl, model: 'deepseek-flash' };
    page = await makePage(false, config);
    await upload('file', false);
    await assertModeControls('fast');
    const hint = await page.$eval('#recognition-mode-hint', (element) => element.textContent);
    assert.match(hint, /原生|thinking|思考|推理/i);
    assert.doesNotMatch(hint, /仅调整识别侧重点/);
    assert.equal(await page.evaluate(() => window.__requests.length), 0);

    await start();
    const fastBody = await assertModeRequest(config, 'fast', true);
    await assertModeControls('fast', true);
    await assertTransferMode('fast');
    await page.click(modeRadio('detailed'));
    await settleUI();
    await assertModeControls('fast', true);
    assert.equal(await page.evaluate(() => window.__requests.length), 1, 'disabled mode controls must not restart recognition');
    await push(prefix + middle);
    await waitCount('rooms', 1);
    await page.waitForFunction(() => window.__scene?.store.plan.rooms.length === 1);
    await cancelRecognition();
    await assertModeControls('fast');
    await originalIntact();

    await switchMode('detailed');
    await assertTransferMode('fast');
    await start();
    const detailedBody = await assertModeRequest(config, 'detailed', true);
    assert.deepEqual(requestImage(detailedBody), requestImage(fastBody), 'retry must reuse the already uploaded image');
    assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
    await assertModeControls('detailed', true);
    await assertTransferMode('detailed');
    await push(prefix + middle + suffix);
    await page.evaluate(() => window.__finish());
    await page.waitForSelector('#upload-apply:not(.hidden)');
    await waitCount('furniture', 1);
    await page.waitForFunction(() => window.__scene?.store.plan.furniture.length === 1);
    await assertModeControls('detailed');
    await assertTransferMode('detailed');
    await switchMode('fast');
    await assertTransferMode('detailed');
    // Cover both a selection different from the last request and a remembered non-default choice.
    const rememberedMode = baseUrl.endsWith('/v1') ? 'detailed' : 'fast';
    if (rememberedMode === 'detailed') await switchMode('detailed');
    await originalIntact();
    await page.click('.modal-close');
    await page.waitForFunction(() => !document.querySelector('#upload-zone'));
    assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
    assert.equal(await page.evaluate(() => window.__requests.length), 2);
    await originalIntact();

    await page.click('#upload-button');
    await assertModeControls(rememberedMode);
    assert.equal(await page.$eval('#upload-recognize', (element) => element.disabled), true);
    assert.equal(await page.evaluate(() => window.__requests.length), 2, 'reopening must not send an old request');
    await upload(baseUrl.endsWith('/v1') ? 'file' : 'paste', false);
    await assertModeControls(rememberedMode);
    await start();
    await assertModeRequest(config, rememberedMode, true);
    await assertModeControls(rememberedMode, true);
    await assertTransferMode(rememberedMode);
    assert.equal(await page.evaluate(() => window.__requests.length), 3, 'reopened modal must not retain stale request listeners');
    await page.click('.modal-close');
    await page.waitForFunction(() => window.__requests.at(-1).signal.aborted && window.__requests.at(-1).cancelled);
    assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
    await originalIntact();
    console.log(`PASS ${baseUrl}: native modes, locked radios, image reuse, stable result labels and remembered selection`);
    await page.close();
  }

  for (const config of bailianConfigs) {
    page = await makePage(false, config);
    const storedBefore = await storedConfig();
    const fields = {
      preset: config.model === 'deepseek-flash' ? 'deepseek-flash' : 'custom',
      model: config.model === 'deepseek-flash' ? '' : config.model,
      provider: config.baseUrl === bailianUrl ? bailianUrl : 'custom',
      url: config.baseUrl === bailianUrl ? '' : config.baseUrl, key: 'test-only',
    };
    await openConfig();
    await assertConfig(fields);
    await assertRequestModel(bailianModel);
    await testConfigConnection(config, bailianModel, 'bailian');
    await page.click('.modal-close');
    await upload('file', false);
    await assertModeControls('fast');
    let previousBody;
    for (const mode of ['fast', 'detailed']) {
      if (mode === 'detailed') {
        await switchMode(mode);
        await assertTransferMode('fast');
      }
      await assertBailianHint(mode);
      await start();
      const body = await assertModeRequest(config, mode, 'bailian', bailianModel);
      if (previousBody) assert.deepEqual(requestImage(body), requestImage(previousBody), 'Bailian mode retry must reuse the uploaded image');
      previousBody = body;
      assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
      await assertModeControls(mode, true);
      await assertTransferMode(mode);
      const count = await requestCount();
      await page.click(modeRadio(mode === 'fast' ? 'detailed' : 'fast'));
      await settleUI();
      await assertModeControls(mode, true);
      await assertBailianHint(mode);
      await assertTransferMode(mode);
      assert.equal(await requestCount(), count, 'locked Bailian controls must not send another request');
      await push(prefix + middle);
      await waitCount('rooms', 1);
      await page.waitForFunction(() => window.__scene?.store.plan.rooms.length === 1);
      await cancelRecognition();
      await page.waitForSelector('#upload-partial:not(.hidden)');
      await assertModeControls(mode);
      await assertTransferMode(mode);
      await originalIntact();
      assert.equal(await storedConfig(), storedBefore, 'Bailian mapping must never migrate stored config');
    }
    await switchMode('fast');
    await assertTransferMode('detailed');
    await assertBailianHint('fast');
    await switchMode('detailed');
    await start();
    const completedBody = await assertModeRequest(config, 'detailed', 'bailian', bailianModel);
    assert.deepEqual(requestImage(completedBody), requestImage(previousBody), 'same-mode retry must also reuse the image');
    assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
    await assertModeControls('detailed', true);
    await assertTransferMode('detailed');
    await push(prefix + middle + suffix);
    await page.evaluate(() => window.__finish());
    await page.waitForSelector('#upload-apply:not(.hidden)');
    await waitCount('furniture', 1);
    await page.waitForFunction(() => window.__scene?.store.plan.furniture.length === 1);
    assert.equal(await page.$eval('#scan-title', (element) => element.textContent), '识别完成，等待确认');
    await assertModeControls('detailed');
    await assertBailianHint('detailed');
    await assertTransferMode('detailed');
    await originalIntact();
    if (config.baseUrl === bailianUrl && config.model === 'deepseek-flash') {
      // Test-only screenshot step; this script never loads a real Chrome profile or key.
      await page.screenshot({ path: fileURLToPath(new URL('../screenshots/2026-11-20-bailian-recognition-modes.png', import.meta.url)) });
    }
    await switchMode('fast');
    await assertBailianHint('fast');
    await assertTransferMode('detailed');
    await originalIntact();
    assert.equal(await requestCount(), 4, 'connection plus three explicit recognitions, with no mode-change requests');
    assert.equal(await storedConfig(), storedBefore);
    await page.click('#upload-apply');
    await page.waitForFunction(() => !document.querySelector('#upload-zone'));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('floorcube.autosave')).name === '流式识别测试');
    assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('floorcube.autosave')).furniture.length), 1);
    assert.equal(await page.$$eval('.room-label img', (elements) => elements.length), 0);
    assert.equal(await page.$eval('[data-view="split"]', (button) => button.classList.contains('active')), true);
    await page.click('[data-view="2d"]');
    assert.equal(await page.$eval('[data-view="2d"]', (button) => button.classList.contains('active')), true);
    assert.equal(await storedConfig(), storedBefore, 'applying a plan must not rewrite Bailian model/baseUrl');
    await openConfig();
    await assertConfig(fields);
    await assertRequestModel(bailianModel);
    await saveConfig({ ...config, apiKey: 'test-only' });
    await openConfig();
    await assertConfig(fields);
    await assertRequestModel(bailianModel);
    assert.equal(await requestCount(), 4);
    console.log(`PASS ${config.baseUrl} / ${config.model}: Bailian mapping, connection, both cancellations, locks, image reuse, stable labels, confirmation and unchanged config strings`);
    await page.close();
  }

  for (const config of [
    { baseUrl: `${appUrl}__recognition-test`, model: 'qwen-vl-max' },
    { baseUrl: 'https://api.deepseek.com/v1', model: 'unknown-vision-model' },
    { baseUrl: deepseekUrl, model: bailianModel },
    { baseUrl: bailianUrl, model: 'qwen-vl-max' },
    { baseUrl: bailianUrl, model: 'DeepSeek-Flash' },
    { baseUrl: bailianUrl, model: 'deepseek-v4-flash' },
    { baseUrl: bailianUrl, model: 'deepseek-v4.1-flash-1017' },
    { baseUrl: maasUrl, model: 'deepseek-v4.1-flash-1017' },
    { baseUrl: 'https://dashscope.aliyuncs.com.example.invalid/compatible-mode/v1', model: 'deepseek-flash' },
    { baseUrl: 'https://notdashscope.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
    { baseUrl: 'https://dashscope-test.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
    { baseUrl: 'https://test-only.maas.aliyuncs.com.example.invalid/v1', model: bailianModel },
    { baseUrl: 'https://notmaas.aliyuncs.com/v1', model: 'deepseek-flash' },
    { baseUrl: 'https://gateway.example.invalid/dashscope.aliyuncs.com/compatible-mode/v1', model: 'deepseek-flash' },
    { baseUrl: 'https://gateway.example.invalid/v1', model: bailianModel },
  ]) {
    page = await makePage(false, config);
    const storedBefore = await storedConfig();
    await openConfig();
    await assertRequestModel(config.model);
    await testConfigConnection(config);
    await page.click('.modal-close');
    await upload('file', false);
    await assertModeControls('fast');
    assert.match(await page.$eval('#recognition-mode-hint', (element) => element.textContent), /仅调整识别侧重点/);
    await start();
    const fastBody = await assertModeRequest(config, 'fast');
    await assertTransferMode('fast');
    await assertModeControls('fast', true);
    await cancelRecognition();
    await assertModeControls('fast');
    await switchMode('detailed');
    assert.match(await page.$eval('#recognition-mode-hint', (element) => element.textContent), /仅调整识别侧重点/);
    await start();
    const detailedBody = await assertModeRequest(config, 'detailed');
    const { messages: fastMessages, ...fastOptions } = fastBody;
    const { messages: detailedMessages, ...detailedOptions } = detailedBody;
    assert.notDeepEqual(detailedMessages, fastMessages);
    assert.deepEqual(detailedOptions, fastOptions, 'unsupported models may change only the recognition prompt');
    assert.deepEqual(requestImage(detailedBody), requestImage(fastBody));
    await assertModeControls('detailed', true);
    await assertTransferMode('detailed');
    await cancelRecognition();
    await page.click('.modal-close');
    await originalIntact();
    assert.equal(await storedConfig(), storedBefore, 'unknown models and non-Bailian hosts must retain their exact config');
    assert.equal(await requestCount(), 3);
    console.log(`PASS ${config.baseUrl} / ${config.model}: unchanged model, prompt-only modes and connection without provider-specific fields`);
    await page.close();
  }

  page = await makePage(true);
  await upload('file', false);
  await assertModeControls('fast');
  await switchMode('detailed', true);
  await switchMode('fast', true);
  await assertMobileModeLayout();
  await start();
  await assertModeControls('fast', true);
  await assertTransferMode('fast');
  await push(prefix + middle);
  await waitCount('rooms', 1);
  await page.click('[data-preview-view="2d"]');
  assert.equal(await page.$eval('.modal', (element) => element.scrollWidth > element.clientWidth), false);
  await assertMobileModeLayout();
  await page.screenshot({ path: fileURLToPath(new URL('../screenshots/2026-11-20-streaming-mobile.png', import.meta.url)) });
  await page.click('#upload-cancel');
  await page.waitForFunction(() => document.querySelector('#scan-title').textContent === '已停止识别');
  assert.equal(await page.evaluate(() => window.__requests[0].signal.aborted && window.__requests[0].cancelled), true);
  await originalIntact();
  await page.waitForSelector('#upload-partial:not(.hidden)');
  await assertModeControls('fast');
  await switchMode('detailed', true);
  await assertTransferMode('fast');
  await assertMobileModeLayout();
  await start();
  await assertModeControls('detailed', true);
  await assertModeRequest({ baseUrl: `${appUrl}__recognition-test`, model: 'qwen-vl-max' }, 'detailed');
  await assertTransferMode('detailed');
  assert.equal(await page.$eval('[data-count="walls"]', (element) => element.textContent), '0');
  await push(prefix + middle);
  await waitCount('rooms', 1);
  await page.evaluate(() => window.__requests.at(-1).controller.error(new TypeError('connection lost')));
  await page.waitForFunction(() => document.querySelector('#scan-title').textContent === '识别未完成');
  await assertModeControls('detailed');
  assert.equal(await page.evaluate(() => window.__requests.length), 2);
  await originalIntact();
  await page.click('#upload-partial');
  await page.waitForFunction(() => !document.querySelector('#upload-zone'));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('floorcube.autosave')).name === '流式识别测试');
  console.log('PASS mobile touch radios and layout, cancellation, fresh retry, interrupted stream and partial application');
  await page.close();

  page = await makePage();
  await page.evaluate(() => { window.__mode = 'json'; });
  await upload();
  await page.waitForFunction(() => document.querySelector('#scan-title').textContent === '接口采用整包返回');
  await page.evaluate((plan) => {
    const controller = window.__requests.at(-1).controller;
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] })));
    controller.close();
  }, result);
  await page.waitForSelector('#upload-apply:not(.hidden)');
  await originalIntact();
  await page.click('.modal-close');
  await originalIntact();
  console.log('PASS honest non-streaming fallback and closing without applying');
  await page.close();

  page = await makePage();
  await upload();
  await push(prefix);
  await waitCount('walls', 1);
  await page.click('.modal-close');
  await page.waitForFunction(() => window.__requests.at(-1).signal.aborted && window.__requests.at(-1).cancelled);
  await originalIntact();
  await page.click('#upload-button');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not an image'], 'broken.png', { type: 'image/png' }));
    const input = document.querySelector('#file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#upload-error:not(.hidden)');
  assert.equal(await page.$eval('#upload-recognize', (button) => button.disabled), true);
  assert.equal(await page.evaluate(() => window.__requests.length), 1);
  console.log('PASS close aborts request and corrupt images cannot start recognition');
  await page.close();

  const customConfig = { baseUrl: `${appUrl}__config-test/v1/`, apiKey: 'test-only', model: 'qwen-test-vision' };
  for (const mobile of [false, true]) {
    page = await makePage(mobile, null, customConfig.baseUrl);
    await openConfig();
    await assertConfig();
    for (const [selector, options] of [
      ['#cfg-model-preset', [['deepseek-flash', 'DeepSeek Flash'], ['custom', '用户自定义']]],
      ['#cfg-provider', [[bailianUrl, '阿里云百炼官方'], [deepseekUrl, 'DeepSeek 官方'], ['custom', '用户自定义']]],
    ]) {
      assert.deepEqual(await page.$eval(selector, (select) => [...select.options].map((option) => [option.value, option.textContent.trim()])), options);
    }
    assert.equal(await page.$$eval('label#cfg-model-custom input#cfg-model, label#cfg-url-custom input#cfg-url', (elements) => elements.length), 2);
    assert.equal(await page.$eval('#cfg-key', (input) => input.type), 'password');
    assert.equal(await page.$eval('#cfg-url-preset', (element) => element.tagName), 'P');
    const help = await page.$eval('.config-help', (element) => element.textContent);
    for (const pattern of [/百炼/, /可用性.*百炼控制台为准/s, /自定义/, /API Key.*所选服务商/s,
      /DeepSeek Flash.*预设.*百炼.*deepseek-v4\.1-flash/s, /快速.*关闭思考/s, /精细.*开启思考/s]) assert.match(help, pattern);
    await assertRequestModel('deepseek-flash');
    if (mobile) await assertConfigLayout();

    await page.select('#cfg-provider', bailianUrl);
    await assertRequestModel(bailianModel);
    await page.select('#cfg-provider', deepseekUrl);
    await assertRequestModel('deepseek-flash');
    await page.select('#cfg-provider', 'custom');
    // Dispatch input alone: a custom-address draft must not depend on select/change or save.
    for (const [url, model] of [
      [bailianUrl, bailianModel], [maasUrl, bailianModel],
      ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', bailianModel],
      ['https://dashscope-us.aliyuncs.com/compatible-mode/v1', bailianModel],
      [deepseekUrl, 'deepseek-flash'],
      ['https://dashscope.aliyuncs.com.example.invalid/v1', 'deepseek-flash'],
      ['https://test-only.maas.aliyuncs.com.example.invalid/v1', 'deepseek-flash'],
      ['https://gateway.example.invalid/dashscope.aliyuncs.com/v1', 'deepseek-flash'],
    ]) {
      await fillConfig({ url }, true);
      await assertRequestModel(model);
      assert.equal(await page.$eval('#cfg-provider', (element) => element.value), 'custom');
    }
    const errorsBeforeDrafts = errors.length;
    for (const url of ['', 'https://', 'not-a-url']) {
      await fillConfig({ url }, true);
      await settleUI();
      assert.match(await page.$eval('#cfg-model-request', (element) => element.textContent), /有效.*地址|地址.*有效/);
      assert.equal(errors.length, errorsBeforeDrafts, 'invalid URL input must not throw a pageerror');
    }
    await fillConfig({ url: maasUrl }, true);
    await assertRequestModel(bailianModel);
    await page.select('#cfg-model-preset', 'custom');
    for (const [model, requestModel] of [
      [bailianModel, bailianModel], ['deepseek-flash', bailianModel],
      ['deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017'],
      ['DeepSeek-Flash', 'DeepSeek-Flash'], [customConfig.model, customConfig.model],
    ]) {
      await fillConfig({ model }, true);
      await assertRequestModel(requestModel);
    }
    await fillConfig({ model: '', url: '' }, true);
    await page.select('#cfg-model-preset', 'deepseek-flash');
    await page.select('#cfg-provider', deepseekUrl);
    await assertConfig();
    await assertRequestModel('deepseek-flash');
    assert.equal(await storedConfig(), null, 'request-model preview must never persist drafts');
    assert.equal(await requestCount(), 0, 'preview updates must not test the connection');

    await rejectConfig(/API Key|密钥|完整/i);
    await fillConfig({ key: 'test-only' });
    await page.select('#cfg-model-preset', 'custom');
    await assertConfig({ preset: 'custom', key: 'test-only' });
    await rejectConfig(/模型|完整/);
    await fillConfig({ model: customConfig.model });
    await assertConfig({ preset: 'custom', model: customConfig.model, key: 'test-only' });
    await page.select('#cfg-provider', 'custom');
    for (const url of ['not-a-url', 'ftp://example.invalid/v1']) {
      await fillConfig({ url });
      await rejectConfig(/http|URL|地址/i);
    }
    await fillConfig({ url: customConfig.baseUrl });
    const drafts = { model: customConfig.model, url: customConfig.baseUrl, key: 'test-only' };
    for (const provider of [deepseekUrl, bailianUrl, 'custom']) {
      await page.select('#cfg-provider', provider);
      await assertConfig({ ...drafts, preset: 'custom', provider });
      for (const preset of ['deepseek-flash', 'custom']) {
        await page.select('#cfg-model-preset', preset);
        await assertConfig({ ...drafts, preset, provider });
        await assertRequestModel(preset === 'custom' ? customConfig.model : provider === bailianUrl ? bailianModel : 'deepseek-flash');
      }
      if (mobile) await assertConfigLayout();
    }
    assert.equal(await storedConfig(), null, 'editing and switching must not auto-save');
    assert.equal(await requestCount(), 0);
    await testConfigConnection(customConfig);
    await saveConfig(customConfig);
    await openConfig();
    await assertConfig({ ...drafts, preset: 'custom', provider: 'custom' });
    await page.click('.config-help summary');
    await assertConfigLayout();
    // Only synthetic test-only credentials are ever present in these screenshots.
    await page.screenshot({ path: fileURLToPath(new URL(`../screenshots/2026-11-20-model-config${mobile ? '-mobile' : ''}.png`, import.meta.url)) });

    await page.click('#cfg-clear');
    await assertConfig();
    assert.equal(await storedConfig(), null);
    await page.select('#cfg-model-preset', 'custom');
    await page.select('#cfg-provider', 'custom');
    await assertConfig({ preset: 'custom', provider: 'custom' });
    await page.click('.modal-close');
    await openConfig();
    await assertConfig();
    assert.equal(await storedConfig(), null);
    assert.equal(await requestCount(), 1, 'reopening and clearing must not send requests');
    await originalIntact();
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'} config: options, defaults, independent drafts, validation, mock connection, persistence, clear and layout`);
    await page.close();
  }

  for (const baseUrl of [bailianUrl, deepseekUrl]) {
    const config = { baseUrl, apiKey: 'test-only', model: 'deepseek-flash' };
    page = await makePage(false, null, baseUrl);
    await openConfig();
    await page.select('#cfg-model-preset', 'custom');
    await page.select('#cfg-provider', 'custom');
    await fillConfig({ model: 'unsaved-custom-model', url: customConfig.baseUrl, key: 'test-only' });
    await page.select('#cfg-model-preset', 'deepseek-flash');
    await page.select('#cfg-provider', baseUrl);
    await assertConfig({ provider: baseUrl, model: 'unsaved-custom-model', url: customConfig.baseUrl, key: 'test-only' });
    const requestModel = baseUrl === bailianUrl ? bailianModel : config.model;
    await assertRequestModel(requestModel);
    await testConfigConnection(config, requestModel, baseUrl === bailianUrl ? 'bailian' : true);
    await saveConfig(config);
    await openConfig();
    await assertConfig({ provider: baseUrl, key: 'test-only' });
    await assertRequestModel(requestModel);
    const savedBefore = await storedConfig();
    await page.select('#cfg-provider', baseUrl === bailianUrl ? deepseekUrl : bailianUrl);
    await assertRequestModel(baseUrl === bailianUrl ? config.model : bailianModel);
    await page.select('#cfg-provider', baseUrl);
    await assertRequestModel(requestModel);
    assert.equal(await storedConfig(), savedBefore, 'switching provider must not migrate the saved alias or URL');
    assert.equal(await requestCount(), 1);
    console.log(`PASS ${baseUrl}: connection uses request model and native fast options; save retains the preset strings, never custom drafts or display labels`);
    await page.close();
  }

  for (const legacy of [
    { baseUrl: 'https://legacy-vision.example.invalid/v1/?tenant=test-only&revision=2', model: 'qwen-vl-max' },
    { baseUrl: `${deepseekUrl}/v1/`, model: 'DeepSeek-Flash' },
  ]) {
    page = await makePage(false, legacy);
    await openConfig();
    const before = await storedConfig();
    const expected = { preset: 'custom', provider: 'custom', model: legacy.model, url: legacy.baseUrl, key: 'test-only' };
    await assertConfig(expected);
    await page.select('#cfg-model-preset', 'deepseek-flash');
    await page.select('#cfg-provider', deepseekUrl);
    await page.select('#cfg-model-preset', 'custom');
    await page.select('#cfg-provider', 'custom');
    await assertConfig(expected);
    assert.equal(await storedConfig(), before, 'legacy strings must remain untouched while switching');
    await saveConfig({ ...legacy, apiKey: 'test-only' });
    await openConfig();
    await assertConfig(expected);
    assert.equal(await requestCount(), 0);
    console.log(`PASS ${legacy.model}: non-exact presets and legacy custom URLs retain their original strings`);
    await page.close();
  }

  for (const entry of ['upload-then-paste', 'config-then-paste', 'paste']) {
    page = await makePage(false, null, deepseekUrl);
    if (entry !== 'paste') {
      await page.click(entry === 'config-then-paste' ? '#config-button' : '#upload-button');
      await page.waitForSelector('#cfg-model-preset', { visible: true });
      await singleOverlay();
    }
    await sendImage('paste');
    await page.waitForSelector('#cfg-model-preset', { visible: true });
    await singleOverlay();
    await assertConfig();
    assert.equal(await storedConfig(), null);
    assert.equal(await requestCount(), 0);
    await fillConfig({ key: 'test-only' });
    const config = { baseUrl: deepseekUrl, apiKey: 'test-only', model: 'deepseek-flash' };
    await saveConfig(config);
    await assertUploadReady();
    await singleOverlay();
    await start();
    await assertModeRequest(config, 'fast', true);
    assert.equal(await requestCount(), 1, 'resuming the pending image must not duplicate recognition listeners');
    await page.click('.modal-close');
    await page.waitForFunction(() => window.__requests.at(-1).signal.aborted && window.__requests.at(-1).cancelled);
    assert.equal(await page.$$eval('.modal-overlay', (elements) => elements.length), 0);
    await originalIntact();
    console.log(`PASS first unconfigured ${entry}: save resumes the pasted image with exactly one overlay`);
    await page.close();
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(blockedRequests, [], 'every model request must use the exact configured mock endpoint, never a network/proxy fallback');
  console.log('PASS all streaming, mode, modal and configuration browser checks; no real model calls were made');
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await page.evaluate(() => ({
      title: document.querySelector('#scan-title')?.textContent,
      error: document.querySelector('#upload-error')?.textContent,
      counts: document.querySelector('#recognition-counts')?.textContent,
      camera: window.__scene?.camera.position.toArray(),
      autoRotate: window.__scene?.controls.autoRotate,
      stable: window.__stableFrames,
      requests: window.__requests.length,
      mode: document.querySelector('input[name="recognition-mode"]:checked')?.value,
      modeLocked: document.querySelector('#recognition-mode-options')?.disabled,
      modeHint: document.querySelector('#recognition-mode-hint')?.textContent,
      transfer: document.querySelector('#recognition-transfer')?.textContent,
      configPreset: document.querySelector('#cfg-model-preset')?.value,
      configProvider: document.querySelector('#cfg-provider')?.value,
      configRequestModel: document.querySelector('#cfg-model-request')?.textContent,
      configResult: document.querySelector('#cfg-result')?.textContent,
      overlays: document.querySelectorAll('.modal-overlay').length,
    })));
  }
  if (blockedRequests.length) console.error('Blocked unmocked requests:', blockedRequests);
  throw error;
} finally {
  await browser.close();
}
