// Local check of the camera page: Chrome plays a video file as the camera, and
// the page has to read the test code from it with each decoder, in portrait
// and in landscape. This proves the page and the decoders, not the iPad.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { TEST_CODE } from '../src/shared.js';
import { makeVideos } from './make-y4m.mjs';
import { startServer } from './serve.mjs';

const PORT = 4310;
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
  { name: 'portrait', width: 1024, height: 1366 },
  { name: 'landscape', width: 1366, height: 1024 },
];
const DECODERS = ['auto', 'zxing', 'jsqr'];

let failures = 0;
function check(ok, label, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` | ${detail}` : ''}`);
}

async function withCamera(videoFile, fn) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${videoFile}`,
    ],
  });
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

async function openCameraPage(browser, viewport, decoder) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: viewport.width, height: viewport.height });
  await page.goto(`http://127.0.0.1:${PORT}/camera?decoder=${decoder}`, { waitUntil: 'load' });
  return { page, errors };
}

const videos = makeVideos();
const server = await startServer(PORT);

try {
  for (const size of ['large', 'small']) {
    await withCamera(videos[size], async (browser) => {
      for (const viewport of VIEWPORTS) {
        for (const decoder of DECODERS) {
          const label = `${size} code, ${viewport.name}, decoder=${decoder}`;
          const { page, errors } = await openCameraPage(browser, viewport, decoder);
          let read = null;
          try {
            await page.waitForSelector('#code[data-read="1"]', { timeout: 10000 });
            read = await page.$eval('#code', (el) => el.textContent.trim());
          } catch {
            /* reported below */
          }
          await new Promise((r) => setTimeout(r, 700));
          const info = await page.evaluate(() => ({
            decoder: document.querySelector('#decoder')?.textContent.trim(),
            first: document.querySelector('#first')?.textContent.trim(),
            stats: document.querySelector('#stats')?.textContent.trim().replace(/\s+/g, ' '),
            sideways: document.documentElement.scrollWidth > window.innerWidth,
            inner: `${window.innerWidth}x${window.innerHeight}`,
            startButtonShown: document.querySelector('#start').getClientRects().length > 0,
          }));
          check(read === TEST_CODE, `${label}: reads the test code`, `${info.decoder} | ${info.first} | ${info.stats}`);
          check(!info.sideways, `${label}: no sideways scroll`, info.inner);
          check(!info.startButtonShown, `${label}: the start button is hidden while the camera runs`);
          check(errors.length === 0, `${label}: no console errors`, errors.join(' ; '));
          await page.screenshot({ path: join(outDir, `camera-${size}-${viewport.name}-${decoder}.png`) });
          await page.close();
        }
      }
    });
  }

  await withCamera(videos.blank, async (browser) => {
    for (const decoder of ['zxing', 'jsqr']) {
      const { page, errors } = await openCameraPage(browser, VIEWPORTS[0], decoder);
      await page.waitForSelector('#stats[data-scans]', { timeout: 10000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      const state = await page.evaluate(() => ({
        read: document.querySelector('#code')?.dataset.read,
        scans: Number(document.querySelector('#stats')?.dataset.scans ?? 0),
      }));
      check(state.read !== '1' && state.scans > 5, `no code in view, decoder=${decoder}: scans and reads nothing`, `scans=${state.scans}`);
      check(errors.length === 0, `no code in view, decoder=${decoder}: no console errors`, errors.join(' ; '));
      await page.close();
    }
  });

  await withCamera(videos.large, async (browser) => {
    for (const path of ['/', '/qr', '/pass']) {
      for (const viewport of [{ name: 'phone', width: 390, height: 844 }, VIEWPORTS[1]]) {
        const page = await browser.newPage();
        const errors = [];
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.setViewport({ width: viewport.width, height: viewport.height });
        const response = await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'load' });
        const info = await page.evaluate(() => ({
          sideways: document.documentElement.scrollWidth > window.innerWidth,
          robots: document.querySelector('meta[name="robots"]')?.content ?? '',
        }));
        check(response.status() === 200, `${path} at ${viewport.name}: loads`, String(response.status()));
        check(!info.sideways, `${path} at ${viewport.name}: no sideways scroll`);
        check(info.robots.includes('noindex'), `${path} at ${viewport.name}: noindex`, info.robots);
        check(errors.length === 0, `${path} at ${viewport.name}: no console errors`, errors.join(' ; '));
        await page.screenshot({ path: join(outDir, `page${path === '/' ? '-index' : path.replace('/', '-')}-${viewport.name}.png`) });
        await page.close();
      }
    }
  });
} finally {
  server.close();
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
