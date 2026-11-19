// Writes short raw video files (Y4M) that Chrome can play as a fake camera:
// the test QR drawn large, drawn small, and a frame with no code in it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { TEST_CODE } from '../src/shared.js';

const W = 1280;
const H = 720;
const FRAMES = 5;
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });

function frameWithQr(qrPixels) {
  // Mid-grey room, white card, black modules.
  const y = Buffer.alloc(W * H, 110);
  if (qrPixels > 0) {
    const qr = QRCode.create(TEST_CODE, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 4;
    const scale = Math.max(1, Math.floor(qrPixels / (n + quiet * 2)));
    const card = (n + quiet * 2) * scale;
    const left = Math.floor((W - card) / 2);
    const top = Math.floor((H - card) / 2);
    for (let row = 0; row < card; row++) {
      for (let col = 0; col < card; col++) {
        const mr = Math.floor(row / scale) - quiet;
        const mc = Math.floor(col / scale) - quiet;
        const inside = mr >= 0 && mc >= 0 && mr < n && mc < n;
        const dark = inside && qr.modules.data[mr * n + mc];
        y[(top + row) * W + left + col] = dark ? 20 : 235;
      }
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  return Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
}

function write(name, qrPixels) {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = frameWithQr(qrPixels);
  const parts = [header];
  for (let i = 0; i < FRAMES; i++) parts.push(frame);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.concat(parts));
  return file;
}

export function makeVideos() {
  return {
    large: write('qr-large.y4m', 480),
    small: write('qr-small.y4m', 170),
    blank: write('blank.y4m', 0),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(makeVideos());
}
