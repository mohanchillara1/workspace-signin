// Builds the throwaway test site into site/. Everything it needs at run time
// is copied in, so the pages load nothing from another server.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import QRCode from 'qrcode';
import { TEST_CODE } from './src/shared.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, 'site');
const assets = join(site, 'assets');
mkdirSync(assets, { recursive: true });

await build({
  entryPoints: [join(here, 'src/camera.js')],
  outfile: join(assets, 'camera.js'),
  bundle: true,
  format: 'esm',
  target: ['safari15', 'chrome110'],
  minify: true,
  legalComments: 'none',
});

copyFileSync(
  join(here, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'),
  join(assets, 'zxing_reader.wasm'),
);

const svg = await QRCode.toString(TEST_CODE, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
writeFileSync(join(assets, 'sample-qr.svg'), svg);

const head = (title) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="data:,">
  <title>${title}</title>
  <link rel="stylesheet" href="/assets/site.css">
</head>`;

writeFileSync(
  join(site, 'qr.html'),
  `${head('Sample code')}
<body class="qr-page">
  <main class="qr-wrap">
    <img src="/assets/sample-qr.svg" alt="A sample QR code" width="400" height="400">
    <p>This is a made-up test code. Hold it up to the iPad's camera.</p>
    <p><code>${TEST_CODE}</code></p>
  </main>
</body>
</html>
`,
);

// The pass file is made once with the signing service and saved next to the
// pages. Until it exists, the pass page says so.
const hasPass = existsSync(join(site, 'test-pass.pkpass'));
writeFileSync(
  join(site, 'pass.html'),
  `${head('Test pass')}
<body>
  <main class="plain">
    <h1>Test pass</h1>
${
  hasPass
    ? `    <p>This is one test pass with a made-up name and a made-up code. Open this page in Safari on an iPhone and tap the button. The phone should offer to add it to Apple Wallet.</p>
    <p><a class="button" href="/test-pass.pkpass">Add the test pass to Apple Wallet</a></p>
    <p>Then open the pass in Wallet and hold its code up to the <a href="/camera">camera page</a> on the iPad. It holds the same code as the <a href="/qr">sample code page</a>.</p>`
    : `    <p>The test pass has not been made yet. It needs an account at the pass-signing service first.</p>
    <p>The <a href="/camera">camera page</a> and the <a href="/qr">sample code page</a> work without it.</p>`
}
  </main>
</body>
</html>
`,
);

writeFileSync(
  join(site, 'index.html'),
  `${head('Camera and pass test')}
<body>
  <main class="plain">
    <h1>Camera and pass test</h1>
    <p>Three test pages. They hold no real names and save nothing.</p>
    <ol>
      <li><a href="/camera">Camera page</a>. Open it on the iPad and allow the camera.</li>
      <li><a href="/qr">Sample code page</a>. Open it on a phone and hold it up to the iPad.</li>
      <li><a href="/pass">Test pass page</a>. Open it in Safari on an iPhone.</li>
    </ol>
  </main>
</body>
</html>
`,
);

console.log(`built site/ (${hasPass ? 'with' : 'without'} the test pass)`);
