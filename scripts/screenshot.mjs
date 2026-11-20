import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
const DATE = '2026-11-20';
const TARGET = new URL(process.env.FLOORCUBE_URL ?? 'http://127.0.0.1:5173');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert(TARGET.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(TARGET.hostname), 'Only a local HTTP dev server is allowed');
assert(!TARGET.username && !TARGET.password && TARGET.pathname === '/' && !TARGET.search && !TARGET.hash, 'FLOORCUBE_URL must be a bare local origin');
const ORIGIN = TARGET.origin;
const DESKTOP = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
const shots = new Map();
const expectedShots = [
  '主界面-桌面3D', '主界面-分屏校正', '主界面-移动端', '主界面-移动端抽屉',
  '模型配置弹窗', '界面焕新-上传户型图', '模拟识别-01图纸', '模拟识别-02结构',
  '模拟识别-03尺寸', '模拟识别-04沙盘', '模拟识别-移动端',
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const record = (label, error) => errors.push(`[${label}] ${String(error)}`);
const checkErrors = () => assert.equal(errors.length, 0, errors.join('\n'));

// Localhost also hosts the model proxy, so checking the origin alone is insufficient.
function allowedRequest(raw, method, origin) {
  if (!['GET', 'HEAD'].includes(String(method).toUpperCase())) return false;
  try {
    const url = new URL(raw, origin);
    if (url.protocol === 'data:') return /^data:(image\/|font\/)/i.test(url.href);
    if (url.protocol === 'blob:') return url.origin === origin;
    if (url.origin !== origin || url.username || url.password) return false;
    const path = decodeURIComponent(url.pathname);
    if (/(^|\/)(api|functions|proxy|v\d+|chat|completions|responses|__blocked-model-api__)(\/|$)/i.test(path)) return false;
    if ([...url.searchParams.keys()].some((key) => !['v', 't', 'import', 'direct', 'raw', 'url', 'inline', 'html-proxy', 'index'].includes(key))) return false;
    return path === '/' || path === '/index.html' || path === '/@vite/client'
      || path.startsWith('/@id/') || path.startsWith('/src/')
      || path.startsWith('/node_modules/') || path.startsWith('/assets/')
      || /^\/[\w.-]+\.(svg|png|webp|jpg|ico|woff2?)$/i.test(path);
  } catch {
    return false;
  }
}

function installHarness({ origin, seed, config }, allow) {
  const faults = [];
  const report = (message) => {
    faults.push(message);
    console.error(`[screenshot network guard] ${message}`);
  };
  const gate = (url, method = 'GET') => {
    if (allow(String(url), method, origin)) return;
    // Do not print URL queries or bodies (even though this profile has no keys).
    let label = 'invalid URL';
    try { const parsed = new URL(String(url), origin); label = parsed.origin + parsed.pathname; } catch { /* invalid URL */ }
    report(`blocked ${method} ${label}`);
    throw new DOMException('Blocked by screenshot network guard', 'SecurityError');
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try { gate(input instanceof Request ? input.url : input, init?.method ?? (input instanceof Request ? input.method : 'GET')); }
    catch (error) { return Promise.reject(error); }
    return nativeFetch(input, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    gate(url, method);
    return Reflect.apply(nativeOpen, this, [method, url, ...rest]);
  };
  navigator.sendBeacon = (url) => { gate(url, 'POST'); return false; };
  const NativeSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(Type, args) {
      const url = new URL(String(args[0]), origin);
      const protocols = Array.isArray(args[1]) ? args[1] : [args[1]];
      // Vite's local HMR socket is not a model transport. Nothing else is allowed.
      if (url.protocol !== 'ws:' || url.host !== new URL(origin).host || url.pathname !== '/' || !protocols.includes('vite-hmr')) {
        report('blocked non-Vite WebSocket');
        throw new DOMException('WebSocket blocked', 'SecurityError');
      }
      return Reflect.construct(Type, args);
    },
  });
  for (const name of ['Worker', 'SharedWorker', 'EventSource']) {
    if (!window[name]) continue;
    window[name] = new Proxy(window[name], {
      construct() { report(`blocked ${name}`); throw new DOMException(`${name} blocked`, 'SecurityError'); },
    });
  }
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => {
      report('blocked service worker registration');
      return Promise.reject(new DOMException('Service worker blocked', 'SecurityError'));
    };
  }

  // Virtual timers expose late callbacks without changing real rendering or camera damping.
  let now = 0;
  let nextId = 1;
  let activeOwner = null;
  const timers = new Map();
  const timerLog = [];
  const schedule = (repeat, callback, delay = 0, ...args) => {
    if (typeof callback !== 'function') throw new Error('String timers are not supported by this test clock');
    const id = nextId++;
    const ms = Math.max(repeat ? 1 : 0, Number(delay) || 0);
    const owner = activeOwner ?? (document.querySelector('#replay-run')?.disabled
      ? document.querySelector('#replay-visual')?.closest('.modal-overlay') : null);
    timers.set(id, { id, callback, args, repeat, ms, due: now + ms, owner });
    timerLog.push({ event: 'schedule', id, at: now, delay: ms, replay: Boolean(owner) });
    return id;
  };
  window.setTimeout = (callback, delay, ...args) => schedule(false, callback, delay, ...args);
  window.setInterval = (callback, delay, ...args) => schedule(true, callback, delay, ...args);
  window.clearTimeout = window.clearInterval = (id) => {
    if (timers.has(id)) timerLog.push({ event: 'clear', id, at: now });
    timers.delete(id);
  };
  const clock = {
    timerLog,
    pendingReplay: () => [...timers.values()].filter((timer) => timer.owner).map(({ id, due, ms }) => ({ id, due, ms })),
    async advance(ms) {
      const end = now + ms;
      let count = 0;
      while (true) {
        const timer = [...timers.values()].filter((item) => item.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!timer) break;
        if (++count > 10000) throw new Error('Virtual timer runaway');
        now = timer.due;
        if (timer.repeat) timer.due += timer.ms;
        else timers.delete(timer.id);
        timerLog.push({ event: 'fire', id: timer.id, at: now, late: Boolean(timer.owner && !timer.owner.isConnected) });
        activeOwner = timer.owner;
        try { Reflect.apply(timer.callback, window, timer.args); }
        finally { activeOwner = null; }
        await Promise.resolve();
      }
      now = end;
      await Promise.resolve();
    },
  };
  const harness = window.__floorcubeScreenshot = { faults, clock, scenes: [], autosaveWrites: 0 };
  // The first observer microtask runs after event binding but before the first rendered frame.
  const stopInitialRotation = new MutationObserver(() => {
    const rotate = document.querySelector('#ctrl-rotate');
    if (!rotate) return;
    stopInitialRotation.disconnect();
    if (rotate.checked) rotate.click();
  });
  stopInitialRotation.observe(document, { childList: true, subtree: true });
  // This storage belongs to a fresh incognito context, never the user's browser.
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('floorcube.onboarded', '1');
  if (seed) localStorage.setItem('floorcube.autosave', JSON.stringify(seed));
  if (config) localStorage.setItem('floorcube.model-config', JSON.stringify(config));
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && key === 'floorcube.autosave') harness.autosaveWrites += 1;
    return Reflect.apply(nativeSetItem, this, [key, value]);
  };
}

let browser;
async function prepare(label, viewport, { seed = null, config = null } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  // All error listeners and BOTH network guards are installed BEFORE goto.
  page.on('pageerror', (error) => record(label, error.stack ?? error));
  page.on('console', (message) => { if (message.type() === 'error') record(label, message.text()); });
  page.on('requestfailed', (request) => record(label, `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.status() >= 400) record(label, `HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('dialog', async (dialog) => { record(label, `Unexpected dialog: ${dialog.message()}`); await dialog.dismiss(); });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || (navigations === 0 && frame.url() === 'about:blank')) return;
    if (++navigations > 1) record(label, 'Unexpected navigation/HMR reload; run against a stable dev server');
  });
  await page.setViewport(viewport);
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const allowed = allowedRequest(request.url(), request.method(), ORIGIN);
    if (!allowed) record(label, `Blocked request: ${request.method()} ${new URL(request.url()).origin}${new URL(request.url()).pathname}`);
    void (allowed ? request.continue() : request.abort('blockedbyclient')).catch((error) => record(label, error));
  });
  await page.evaluateOnNewDocument(`(${installHarness.toString()})(${JSON.stringify({ origin: ORIGIN, seed, config })}, ${allowedRequest.toString()})`);
  await page.goto(ORIGIN, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#scene-container canvas', { visible: true });
  await page.evaluate(() => {
    const rotate = document.querySelector('#ctrl-rotate');
    if (!rotate) throw new Error('Missing #ctrl-rotate');
    // Use the existing settings control, not private scene/App state.
    if (rotate.checked) rotate.click();
  });
  await installSceneProbe(page);
  await settle(page);
  await noOverflow(page, label);
  checkErrors();
  return { page, close: () => context.close() };
}

async function importedUrl(page, pathname) {
  return page.evaluate((path) => {
    const urls = [...new Set(performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => new URL(url).pathname === path))];
    if (urls.length !== 1) throw new Error(`Expected one currently imported ${path}, found ${urls.length}; avoid HMR during capture`);
    return urls[0];
  }, pathname);
}

async function installSceneProbe(page) {
  // Vite's timestamped URL is needed to hook the same FloorScene class as App.
  const url = await importedUrl(page, '/src/scene/FloorScene.ts');
  await page.evaluate(async (resource) => {
    const { FloorScene } = await import(resource);
    const harness = window.__floorcubeScreenshot;
    for (const method of ['rebuild', 'dispose']) {
      const original = FloorScene.prototype[method];
      if (typeof original !== 'function') throw new Error(`Missing FloorScene.${method}`);
      FloorScene.prototype[method] = function (...args) {
        let entry = harness.scenes.find((item) => item.scene === this);
        if (!entry && this.container?.id === 'replay-scene') {
          entry = { scene: this, rebuilds: 0, disposals: 0, callsAfterDispose: 0 };
          harness.scenes.push(entry);
        }
        if (entry) {
          if (entry.disposals) entry.callsAfterDispose += 1;
          entry[method === 'dispose' ? 'disposals' : 'rebuilds'] += 1;
        }
        return Reflect.apply(original, this, args);
      };
    }
  }, url);
}

async function frames(page, count = 2) {
  await page.evaluate(async (number) => {
    for (let i = 0; i < number; i++) await new Promise(requestAnimationFrame);
  }, count);
}

async function settle(page) {
  await frames(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((image) => image.getClientRects().length && image.src).map((image) => image.decode()));
    const animations = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  });
  await frames(page);
}

async function advance(page, ms) {
  await page.evaluate((duration) => window.__floorcubeScreenshot.clock.advance(duration), ms);
  await frames(page);
  checkErrors();
}

async function noOverflow(page, label) {
  const problems = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const result = [];
    for (const element of [document.documentElement, document.body, ...document.querySelectorAll('.modal-overlay, .modal, .modal-body, .replay-layout, .replay-steps, .modal-actions')]) {
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      if (element.scrollWidth > element.clientWidth + 1 || rect.left < -1 || rect.right > width + 1) {
        result.push(`${element.id || element.className || element.tagName}: ${element.scrollWidth}/${element.clientWidth}, x=${rect.left}..${rect.right}`);
      }
    }
    return result;
  });
  assert.deepEqual(problems, [], `${label}: horizontal overflow\n${problems.join('\n')}`);
}

async function reachable(page, selector) {
  const element = await page.waitForSelector(selector, { visible: true });
  await element.scrollIntoView();
  await settle(page);
  const rect = await element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, ok: box.width > 0 && box.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && (top === node || node.contains(top)) };
  });
  await element.dispose();
  assert(rect.ok, `${selector} is clipped, covered or unreachable`);
  return rect;
}

async function click(page, selector, { disabled = false } = {}) {
  const point = await reachable(page, selector);
  if (!disabled) assert.equal(await page.$eval(selector, (node) => Boolean(node.disabled)), false, `${selector} is disabled`);
  if (page.viewport().hasTouch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await settle(page);
  await noOverflow(page, selector);
  checkErrors();
}

async function shot(page, name) {
  assert(expectedShots.includes(name) && !shots.has(name), `Unexpected/duplicate screenshot: ${name}`);
  // Interactions can scroll the dialog; captures should include its heading.
  await page.evaluate(() => document.querySelector('.modal')?.scrollTo({ top: 0, behavior: 'instant' }));
  await settle(page);
  await noOverflow(page, name);
  checkErrors();
  shots.set(name, await page.screenshot({ type: 'png', fullPage: false }));
}

async function workspace(page) {
  return page.evaluate(() => ({
    name: document.querySelector('#status-name').textContent,
    furniture: document.querySelector('#status-furniture').textContent,
    area: document.querySelector('#status-area').textContent,
    view: document.querySelector('#viewport-stack').dataset.view,
    autosave: localStorage.getItem('floorcube.autosave'),
    writes: window.__floorcubeScreenshot.autosaveWrites,
  }));
}
const unchanged = async (page, before, label) => assert.deepEqual(await workspace(page), before, `${label}: workspace changed before apply`);
const pending = (page) => page.evaluate(() => window.__floorcubeScreenshot.clock.pendingReplay());

async function openReplay(page) {
  assert.equal(await page.$eval('body', () => localStorage.getItem('floorcube.model-config')), null, 'Replay must run with NO API Key/config');
  await click(page, '#replay-button');
  assert.equal(await page.$$eval('.modal-overlay', (nodes) => nodes.length), 1);
  assert.equal(await page.$eval('[role="dialog"]', (node) => node.getAttribute('aria-label')), '模拟识别演示');
  assert.equal(await page.$eval('#replay-run', (node) => node.textContent.trim()), '开始演示');
  assert.equal(await page.$eval('#replay-run', (node) => node.disabled), false);
}

async function stage(page, index, demo) {
  await settle(page);
  const state = await page.evaluate(() => {
    const visible = (node) => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none');
    const buttons = [...document.querySelectorAll('.replay-steps button')];
    return {
      stage: document.querySelector('#replay-visual')?.dataset.stage,
      steps: buttons.map((button) => button.dataset.replayStep),
      active: [...document.querySelectorAll('.replay-steps li.active')].map((node) => node.querySelector('button')?.dataset.replayStep),
      current: buttons.filter((button) => button.hasAttribute('aria-current')).map((button) => [button.dataset.replayStep, button.getAttribute('aria-current')]),
      imageVisible: visible(document.querySelector('#replay-plan')),
      sceneVisible: visible(document.querySelector('#replay-scene')),
      canvasCount: document.querySelectorAll('#replay-scene canvas').length,
      apply: visible(document.querySelector('#replay-apply')),
      overlays: document.querySelectorAll('.modal-overlay').length,
    };
  });
  assert.equal(state.stage, String(index), `Expected stage ${index}`);
  assert.deepEqual(state.steps, ['0', '1', '2', '3']);
  assert.deepEqual(state.active, [String(index)], 'Exactly the current li must be active');
  assert.deepEqual(state.current, [[String(index), 'step']], 'Only the current button has aria-current=step');
  assert.equal(state.overlays, 1);
  assert.equal(state.apply, index === 3, 'Apply is visible only on step 4');
  assert.equal(state.imageVisible, index < 3);
  assert.equal(state.sceneVisible, index === 3);
  await noOverflow(page, `step ${index}`);
  if (index === 3) {
    assert.equal(state.canvasCount, 1, 'The final step needs one real WebGL canvas');
    const preview = await page.evaluate(() => {
      const entries = window.__floorcubeScreenshot.scenes.filter((item) => !item.disposals && item.scene.container.isConnected);
      if (entries.length !== 1) throw new Error(`Expected one live captured replay scene, found ${entries.length}`);
      const scene = entries[0].scene;
      return { plan: scene.store.plan, furniture: scene.furnitureGroup.children.length, renders: scene.renderer.info.render.frame, canvas: scene.renderer.domElement.width > 0 && scene.renderer.domElement.height > 0 };
    });
    assert.deepEqual(preview.plan, demo.applied, 'Preview uses the selected getDemoPlan');
    assert.equal(preview.furniture, demo.applied.furniture.length);
    assert(preview.renders > 0 && preview.canvas, 'Preview has not rendered');
    return null;
  }
  const svgUrl = await importedUrl(page, '/src/data/planSvg.ts');
  const image = await page.evaluate(async ({ index, demo, svgUrl }) => {
    const img = document.querySelector('#replay-plan');
    await img.decode();
    if (!img.src.startsWith('data:image/svg+xml')) throw new Error('Replay image must be a local SVG data URL');
    const comma = img.src.indexOf(',');
    const svg = img.src.slice(0, comma).includes(';base64') ? atob(img.src.slice(comma + 1)) : decodeURIComponent(img.src.slice(comma + 1));
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.tagName !== 'svg') throw new Error('Invalid SVG');
    const { planToSvg } = await import(svgUrl);
    const expected = planToSvg(demo.plan, Number(root.getAttribute('width')), ['drawing', 'structure', 'analysis'][index]);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { src: img.src, matches: svg.trim() === expected.trim(), pixels: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  }, { index, demo, svgUrl });
  assert(image.matches, `${demo.id}, stage ${index}: wrong demo or SVG mode`);
  assert(image.width > 0 && image.height > 0);
  return { src: digest(image.src), pixels: digest(image.pixels) };
}

function distinctImages(images, label) {
  assert.equal(new Set(images.map((image) => image.src)).size, 3, `${label}: SVG src did not change`);
  assert.equal(new Set(images.map((image) => image.pixels)).size, 3, `${label}: left-hand images are visually identical`);
}

async function playing(page, expected) {
  const state = await page.$eval('#replay-run', (node) => ({ disabled: node.disabled, text: node.textContent.trim() }));
  assert.equal(state.disabled, expected);
  if (expected) assert.equal(state.text, '播放中…');
}

async function noReplayTimers(page) {
  assert.deepEqual(await pending(page), [], 'Replay timers were not cleaned up');
  assert.equal(await page.evaluate(() => window.__floorcubeScreenshot.clock.timerLog.some((event) => event.late)), false, 'A timer fired after its replay overlay closed');
}

async function disposed(page) {
  const scenes = await page.evaluate(() => window.__floorcubeScreenshot.scenes.map((entry) => ({
    disposals: entry.disposals, after: entry.callsAfterDispose, disposed: entry.scene.disposed,
    connected: entry.scene.renderer.domElement.isConnected,
  })));
  for (const scene of scenes) assert.deepEqual(scene, { disposals: 1, after: 0, disposed: true, connected: false }, 'Replay preview leaked or was reused after disposal');
}

async function closeReplay(page, method = 'button') {
  if (method === 'escape') {
    await page.keyboard.press('Escape');
    await settle(page);
  } else {
    await click(page, '.modal-close');
  }
  assert.equal(await page.$$eval('.modal-overlay', (nodes) => nodes.length), 0);
  await noReplayTimers(page);
  await disposed(page);
}

async function applyReplay(page, demo) {
  await click(page, '#replay-apply');
  assert.equal(await page.$$eval('.modal-overlay', (nodes) => nodes.length), 0, 'Apply must close overlay');
  await noReplayTimers(page);
  await disposed(page);
  await advance(page, 10000); // flush autosave/toasts and expose any late completion
  const state = await workspace(page);
  assert.equal(state.name, demo.applied.name);
  assert.equal(state.furniture, `${demo.applied.furniture.length} 件家具`);
  assert.deepEqual(JSON.parse(state.autosave), demo.applied, 'Applied plan differs from getDemoPlan');
  for (const view of ['split', '2d', '3d']) {
    await click(page, `[data-view="${view}"]`);
    assert.equal(await page.$eval('#viewport-stack', (node) => node.dataset.view), view);
    assert.equal(await page.$eval('#status-furniture', (node) => node.textContent), `${demo.applied.furniture.length} 件家具`);
  }
  await noReplayTimers(page);
}

async function cameraState(page) {
  return page.evaluate(() => {
    const entry = window.__floorcubeScreenshot.scenes.findLast((item) => !item.disposals && item.scene.container.isConnected);
    if (!entry) throw new Error('No live replay camera');
    return [...entry.scene.camera.position.toArray(), ...entry.scene.controls.target.toArray()];
  });
}

async function waitCameraSettled(page) {
  // Wait for actual damped rendering, not an arbitrary sleep or a camera reset.
  await page.evaluate(async () => {
    const scene = window.__floorcubeScreenshot.scenes.findLast((item) => !item.disposals && item.scene.container.isConnected).scene;
    let previous = [...scene.camera.position.toArray(), ...scene.controls.target.toArray()];
    let stable = 0;
    for (let frame = 0; frame < 300; frame++) {
      await new Promise(requestAnimationFrame);
      const current = [...scene.camera.position.toArray(), ...scene.controls.target.toArray()];
      stable = Math.max(...current.map((value, index) => Math.abs(value - previous[index]))) < 0.0001 ? stable + 1 : 0;
      if (stable >= 5) return;
      previous = current;
    }
    throw new Error('Replay camera does not settle (auto-rotation or repeated reset)');
  });
}

async function rotateAndHold(page, demo) {
  const point = await reachable(page, '#replay-scene canvas');
  const box = await page.$eval('#replay-scene canvas', (node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
  const before = await cameraState(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + box.width * 0.22, point.y + box.height * 0.1, { steps: 12 });
  await page.mouse.up();
  await waitCameraSettled(page);
  const rotated = await cameraState(page);
  assert(Math.max(...rotated.map((value, index) => Math.abs(value - before[index]))) > 0.05, 'Canvas drag did not rotate the actual camera');
  const images = [];
  for (const index of [0, 1, 2]) {
    await click(page, `[data-replay-step="${index}"]`);
    images.push(await stage(page, index, demo));
  }
  distinctImages(images, 'review after rotation');
  await click(page, '[data-replay-step="3"]');
  await stage(page, 3, demo);
  await waitCameraSettled(page);
  const returned = await cameraState(page);
  assert(Math.max(...returned.map((value, index) => Math.abs(value - rotated[index]))) < 0.01, 'Reviewing steps reset the manually rotated preview camera');
  await advance(page, 7200);
  await waitCameraSettled(page);
  const held = await cameraState(page);
  assert(Math.max(...held.map((value, index) => Math.abs(value - rotated[index]))) < 0.01, 'Completed preview did not preserve its camera');
}

async function desktopReplay(page, demos) {
  const demo = demos[1]; // App's documented fallback when the seeded plan has no demo selection.
  const before = await workspace(page);
  assert.equal(before.name, '原有方案');
  await openReplay(page);
  // The modal covers its opener, so duplicate invocation needs a programmatic click.
  await page.$eval('#replay-button', (button) => { button.click(); button.click(); });
  assert.equal(await page.$$eval('.modal-overlay', (nodes) => nodes.length), 1);
  const images = [await stage(page, 0, demo)];
  await shot(page, '模拟识别-01图纸');
  await click(page, '#replay-run');
  await playing(page, true);
  await stage(page, 0, demo);
  const timers = await pending(page);
  assert(timers.length > 0, 'Autoplay did not schedule timers');
  await click(page, '#replay-run', { disabled: true });
  assert.deepEqual(await pending(page), timers, 'Disabled run button started duplicate timers');
  for (let index = 1; index <= 3; index++) {
    await advance(page, 1799);
    await stage(page, index - 1, demo);
    await advance(page, 1);
    const image = await stage(page, index, demo);
    if (image) images.push(image);
    if (index < 3) await playing(page, true);
    await unchanged(page, before, `autoplay step ${index}`);
    await shot(page, ['模拟识别-01图纸', '模拟识别-02结构', '模拟识别-03尺寸', '模拟识别-04沙盘'][index]);
  }
  distinctImages(images, 'autoplay');
  await playing(page, false);
  assert.equal(await page.$eval('#replay-run', (node) => node.textContent.trim()), '重新播放');
  await noReplayTimers(page);
  await advance(page, 12000);
  await stage(page, 3, demo);
  await unchanged(page, before, 'completed autoplay');
  await rotateAndHold(page, demo);
  await unchanged(page, before, 'preview rotation/review');

  // Restart must synchronously return to 0, and review must cancel ALL timers.
  await click(page, '#replay-run');
  await stage(page, 0, demo);
  await playing(page, true);
  await advance(page, 1800);
  await stage(page, 1, demo);
  await click(page, '[data-replay-step="0"]');
  await noReplayTimers(page);
  await playing(page, false);
  await advance(page, 10000);
  await stage(page, 0, demo);
  await unchanged(page, before, 'manual review stops autoplay');

  for (const method of ['button', 'escape']) {
    await click(page, '#replay-run');
    await advance(page, 1800);
    await stage(page, 1, demo);
    assert((await pending(page)).length > 0);
    await closeReplay(page, method);
    await advance(page, 12000);
    await noReplayTimers(page);
    await unchanged(page, before, `cancel by ${method}`);
    assert.equal(await page.$$eval('.modal-overlay', (nodes) => nodes.length), 0);
    await openReplay(page);
    await stage(page, 0, demo);
  }
  await click(page, '#replay-run');
  await advance(page, 1800);
  await click(page, '#replay-skip');
  await stage(page, 3, demo);
  await playing(page, false);
  await noReplayTimers(page);
  await advance(page, 10000);
  await unchanged(page, before, 'skip does not apply');
  await applyReplay(page, demo);

  // Each selected demo is checked against imported data, never copied counts.
  for (const entry of demos) {
    await reachable(page, '#demo-select');
    await page.select('#demo-select', entry.id);
    await advance(page, 10000);
    const original = await workspace(page);
    await openReplay(page);
    const manual = [];
    for (let index = 0; index < 4; index++) {
      await click(page, `[data-replay-step="${index}"]`);
      const image = await stage(page, index, entry);
      if (image) manual.push(image);
      await unchanged(page, original, `${entry.id} manual step ${index}`);
    }
    distinctImages(manual, entry.id);
    await noReplayTimers(page);
    await closeReplay(page);
    await advance(page, 10000);
    await unchanged(page, original, `${entry.id} close`);
  }
}

async function mobileReplay(page, demo, capture = false) {
  const before = await workspace(page);
  await openReplay(page);
  const images = [];
  for (let index = 0; index < 4; index++) {
    await click(page, `[data-replay-step="${index}"]`);
    const image = await stage(page, index, demo);
    if (image) images.push(image);
    await reachable(page, '#replay-run');
    await reachable(page, index === 3 ? '#replay-apply' : '#replay-skip');
    await unchanged(page, before, `mobile manual step ${index}`);
  }
  distinctImages(images, `mobile ${page.viewport().width}px`);
  if (capture) await shot(page, '模拟识别-移动端');
  await click(page, '#replay-run');
  await stage(page, 0, demo);
  await playing(page, true);
  await advance(page, 1800);
  await stage(page, 1, demo);
  await click(page, '#replay-skip');
  await stage(page, 3, demo);
  await noReplayTimers(page);
  await advance(page, 10000);
  await unchanged(page, before, 'mobile skip');
  await applyReplay(page, demo);
}

try {
  // Omitting userDataDir keeps user profiles and their saved credentials untouched.
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]',
    ],
  });
  const desktop = await prepare('desktop', DESKTOP);
  const demosUrl = await importedUrl(desktop.page, '/src/data/demos.ts');
  const demos = await desktop.page.evaluate(async (url) => {
    const { DEMO_PLANS, getDemoPlan } = await import(url);
    return DEMO_PLANS.map((entry) => ({ ...entry, applied: getDemoPlan(entry.id) }));
  }, demosUrl);
  assert.equal(demos.length, 4, 'Expected the four shipped demos');
  await shot(desktop.page, '主界面-桌面3D');
  await click(desktop.page, '[data-view="split"]');
  await shot(desktop.page, '主界面-分屏校正');
  await click(desktop.page, '[data-view="3d"]');
  await click(desktop.page, '#config-button');
  const provider = await desktop.page.$$eval('#cfg-provider option', (options) => options.find((option) => option.textContent.includes('百炼'))?.value);
  assert(provider, 'Missing Bailian provider');
  await reachable(desktop.page, '#cfg-provider');
  await desktop.page.select('#cfg-provider', provider);
  const clientUrl = await importedUrl(desktop.page, '/src/ai/client.ts');
  const model = await desktop.page.evaluate(async (url) => {
    const { getRequestModel } = await import(url); // pure configuration mapping; NO testConnection/recognition call
    return getRequestModel({ baseUrl: document.querySelector('#cfg-provider').value, model: document.querySelector('#cfg-model-preset').value });
  }, clientUrl);
  assert(model && (await desktop.page.$eval('#cfg-model-request', (node) => node.textContent)).includes(model), 'Actual request model is not displayed');
  assert.equal(await desktop.page.$eval('#cfg-key', (node) => node.value), '');
  await shot(desktop.page, '模型配置弹窗');
  await click(desktop.page, '.modal-close');
  await desktop.close();

  const original = { ...structuredClone(demos[0].applied), name: '原有方案' };
  const replay = await prepare('desktop replay', DESKTOP, { seed: original });
  await desktopReplay(replay.page, demos);
  await replay.close();

  const mobile = await prepare('mobile 390', MOBILE);
  await shot(mobile.page, '主界面-移动端');
  await click(mobile.page, '#drawer-toggle');
  assert.equal(await mobile.page.$eval('#drawer-toggle', (node) => node.getAttribute('aria-expanded')), 'true');
  await shot(mobile.page, '主界面-移动端抽屉');
  await click(mobile.page, '#drawer-toggle');
  await mobileReplay(mobile.page, demos[1], true);
  await mobile.close();

  const narrow = await prepare('mobile 320', { ...MOBILE, width: 320 }, { seed: original });
  await click(narrow.page, '#drawer-toggle');
  await click(narrow.page, '#drawer-toggle');
  await mobileReplay(narrow.page, demos[1]);
  await narrow.close();

  // Upload requires a configuration to open; this separate context uses only a dummy key.
  const upload = await prepare('upload UI only', DESKTOP, { config: { baseUrl: provider, model, apiKey: 'TEST_ONLY_NOT_A_REAL_KEY' } });
  await click(upload.page, '#upload-button');
  await upload.page.waitForSelector('#upload-zone', { visible: true });
  assert.equal(await upload.page.$eval('#upload-recognize', (node) => node.disabled), true);
  await shot(upload.page, '界面焕新-上传户型图');
  await click(upload.page, '.modal-close');
  await upload.close();

  checkErrors();
  assert.deepEqual([...shots.keys()].sort(), [...expectedShots].sort());
  // Publish only after ALL regression assertions pass. No rm/unlink/pruning.
  mkdirSync(OUT, { recursive: true });
  for (const name of expectedShots) {
    const path = join(OUT, `${DATE}-${name}.png`);
    writeFileSync(path, shots.get(name));
    console.log(`Saved ${path}`);
  }
  console.log(`PASS: ${shots.size} screenshots; 4 demos, 1440/390/320px, playback/review/skip/apply/cleanup/camera; no model requests. README unchanged.`);
} catch (error) {
  console.error(error.stack ?? error);
  if (errors.length) console.error(errors.join('\n'));
  console.error('FAILED: do not treat this run as a completed screenshot/regression update.');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
