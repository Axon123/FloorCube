import puppeteer from 'puppeteer-core';

const KEY = process.env.DEEPSEEK_KEY;
if (!KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量');
  process.exit(1);
}
const IMAGE = process.env.E2E_IMAGE || '/Users/lisiqi/.qoder-cn/tmp/-Users-lisiqi-Qoder--/images/7c9160c9-81bb-442b-bf72-c70b6ce3bf3c/eb4ee74a-641c-400d-85dc-0dbd67ff4512.png';
const OUT = '/Users/lisiqi/Qoder大赛/screenshots';
const APP = 'http://127.0.0.1:5173/';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

const fail = async (message) => {
  console.error('FAIL:', message);
  await page.screenshot({ path: `${OUT}/2026-11-19-真实识别-失败现场.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

await page.goto(APP, { waitUntil: 'networkidle0' });
await page.evaluate((key) => {
  localStorage.setItem('floorcube.onboarded', '1');
  localStorage.setItem('floorcube.model-config', JSON.stringify({ baseUrl: 'https://api.deepseek.com', apiKey: key, model: 'deepseek-flash' }));
  localStorage.removeItem('floorcube.autosave');
  localStorage.removeItem('floorcube.projects');
}, KEY);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('#scene-container canvas');
await new Promise((r) => setTimeout(r, 2500));

console.log('step 1: 测试连接（真实 DeepSeek 接口）');
await page.click('#config-button');
await page.waitForSelector('#cfg-test');
await page.click('#cfg-test');
try {
  await page.waitForFunction(() => {
    const el = document.querySelector('#cfg-result');
    return el && !el.classList.contains('hidden') && /连接成功|失败|无效|拒绝|超时|不存在|频繁/.test(el.textContent);
  }, { timeout: 90_000 });
} catch { await fail('测试连接超时'); }
const testResult = await page.$eval('#cfg-result', (el) => el.textContent);
console.log('  连接测试结果:', testResult);
if (!testResult.includes('连接成功')) await fail(`测试连接未通过: ${testResult}`);
await page.click('.modal-close');
await new Promise((r) => setTimeout(r, 400));

console.log('step 2: 上传真实户型图并识别（最长等待 5 分钟）');
await page.click('#upload-button');
await page.waitForSelector('#upload-zone');
const input = await page.$('#file-input');
await input.uploadFile(IMAGE);
await page.waitForFunction(() => !document.querySelector('#upload-recognize').disabled, { timeout: 15_000 });
await page.click('#upload-recognize');
const start = Date.now();
try {
  await page.waitForFunction(() => {
    if (!document.querySelector('.modal-overlay')) return 'done';
    const err = document.querySelector('#upload-error');
    if (err && !err.classList.contains('hidden')) return 'error';
    return false;
  }, { timeout: 560_000, polling: 1000 });
} catch { await fail('识别等待超时'); }
const outcome = await page.evaluate(() => (document.querySelector('.modal-overlay') ? 'error' : 'done'));
if (outcome === 'error') {
  const detail = await page.$eval('#upload-error', (el) => el.textContent);
  await fail(`识别失败: ${detail}`);
}
console.log(`  识别成功，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);

await new Promise((r) => setTimeout(r, 2500));
const summary = await page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem('floorcube.autosave') || 'null');
  return {
    name: plan?.name,
    walls: plan?.walls?.length ?? 0,
    rooms: plan?.rooms?.length ?? 0,
    openings: plan?.openings?.length ?? 0,
    areaHint: plan?.totalAreaHint,
    view: document.querySelector('#viewport-stack')?.dataset.view,
    bodyHasName: plan?.name ? document.body.innerText.includes(plan.name) : false,
  };
});
console.log('step 3: 校验生成结果', JSON.stringify(summary));
if (!summary.walls || !summary.rooms || !summary.bodyHasName) await fail('生成的户型数据不完整');

await page.screenshot({ path: `${OUT}/2026-11-19-真实识别-分屏校正.png` });
await page.click('[data-view="3d"]');
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/2026-11-19-真实识别-3D沙盘.png` });

if (consoleErrors.length) {
  console.log('控制台错误:', consoleErrors.slice(0, 5));
  await fail('存在控制台错误');
}
console.log('PASS: 上传 → DeepSeek 识别 → 3D 建模全链路通过');
await browser.close();