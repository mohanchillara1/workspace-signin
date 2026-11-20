// Draws the Home Screen icons for the kiosk from app/icon.svg.
//   npx tsx scripts/make-icons.ts
// The pictures are committed (public/icons/), so this only needs running when
// the icon changes. It uses the same Chrome the browser tests use.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SIZES = [180, 192, 512];
const BACKGROUND = '#050507';

async function main() {
  const svg = readFileSync('app/icon.svg', 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' });
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      // A solid square with the mark in the middle: a touch icon must have no
      // see-through pixels, and the edges may be cut round by the device.
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%;background:${BACKGROUND}}body{display:grid;place-items:center}svg{width:78%;height:78%}</style>${svg}`,
      );
      await page.screenshot({ path: `public/icons/kiosk-${size}.png`, omitBackground: false });
      await page.close();
      console.log(`public/icons/kiosk-${size}.png`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
