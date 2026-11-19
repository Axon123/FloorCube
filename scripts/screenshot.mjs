import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = '/Users/lisiqi/Qoder大赛/screenshots';
mkdirSync(OUT, { recursive: true });
const URL = 'http://127.0.0.1:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
});

async function prepare(page) {
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.setItem('floorcube.onboarded', '1');
    localStorage.removeItem('floorcube.autosave');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#scene-container canvas');
  await new Promise((r) => setTimeout(r, 2500));
}

const desktop = await browser.newPage();
await desktop.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await prepare(desktop);
await desktop.screenshot({ path: `${OUT}/2026-11-19-主界面-桌面3D.png` });

await desktop.evaluate(() => document.querySelector('[data-view="split"]').click());
await new Promise((r) => setTimeout(r, 1200));
await desktop.screenshot({ path: `${OUT}/2026-11-19-主界面-分屏校正.png` });

await desktop.evaluate(() => {
  document.querySelector('[data-view="3d"]').click();
  document.querySelector('#config-button').click();
});
await new Promise((r) => setTimeout(r, 600));
await desktop.screenshot({ path: `${OUT}/2026-11-19-模型配置弹窗.png` });
await desktop.evaluate(() => document.querySelector('.modal-close').click());

const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await prepare(mobile);
await mobile.screenshot({ path: `${OUT}/2026-11-19-主界面-移动端.png` });
await mobile.evaluate(() => document.querySelector('#drawer-toggle').click());
await new Promise((r) => setTimeout(r, 700));
await mobile.screenshot({ path: `${OUT}/2026-11-19-主界面-移动端抽屉.png` });

const errors = [];
desktop.on('pageerror', (e) => errors.push(String(e)));
mobile.on('pageerror', (e) => errors.push(String(e)));
console.log('screenshots done', errors);
await browser.close();
