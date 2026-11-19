// One-off check of the deployed copy: the same fake camera, the live address.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { TEST_CODE } from '../src/shared.js';
import { makeVideos } from './make-y4m.mjs';

const base = process.argv[2];
if (!base) throw new Error('usage: node test/live.mjs https://the-site');
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
const videos = makeVideos();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${videos.small}`],
});
let failed = 0;
try {
  for (const decoder of ['auto', 'zxing', 'jsqr']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport({ width: 1024, height: 1366 });
    await page.goto(`${base}/camera?decoder=${decoder}`, { waitUntil: 'load' });
    let read = null;
    try {
      await page.waitForSelector('#code[data-read="1"]', { timeout: 15000 });
      read = await page.$eval('#code', (el) => el.textContent.trim());
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
    const info = await page.evaluate(() => `${document.querySelector('#decoder').textContent} | ${document.querySelector('#first').textContent} | ${document.querySelector('#stats').textContent}`);
    const ok = read === TEST_CODE && errors.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} live ${decoder}: ${info}${errors.length ? ` | errors: ${errors.join(' ; ')}` : ''}`);
    await page.screenshot({ path: join(outDir, `live-camera-${decoder}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
