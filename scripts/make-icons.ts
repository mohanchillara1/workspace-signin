// Draws every icon from the team logo (public/team-logo.png, from singularity-frc.com).
//   npx tsx scripts/make-icons.ts
// The pictures are committed, so this only needs running when the logo changes.
// It uses the same Chrome the browser tests use (set CHROME on a Mac).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BACKGROUND = '#050507';
// [file, size, share of the square left empty on each side, solid background?]
// A touch icon must have no see-through pixels, and Android cuts its icons
// round, so those get a solid square and more room. The tab icon stays clear.
const ICONS: [string, number, number, boolean][] = [
  ['public/icons/kiosk-180.png', 180, 0.06, true],
  ['public/icons/kiosk-192.png', 192, 0.12, true],
  ['public/icons/kiosk-512.png', 512, 0.12, true],
  ['public/apple-touch-icon.png', 180, 0.06, true],
  ['public/home-icon-192.png', 192, 0.12, true],
  ['public/home-icon-512.png', 512, 0.12, true],
  ['app/icon.png', 64, 0, false],
];

async function main() {
  const logo = `data:image/png;base64,${readFileSync('public/team-logo.png').toString('base64')}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' });
  try {
    for (const [path, size, pad, solid] of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%;background:${solid ? BACKGROUND : 'transparent'}}body{display:grid;place-items:center}img{width:${100 - pad * 200}%}</style><img src="${logo}">`,
      );
      await page.waitForFunction(() => document.images[0].complete);
      await page.screenshot({ path, omitBackground: !solid });
      await page.close();
      console.log(path);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
