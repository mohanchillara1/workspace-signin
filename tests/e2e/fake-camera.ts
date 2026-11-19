// Writes a short raw video (Y4M) of a QR code, for Chrome to play as a camera.
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

export function writeQrVideo(file: string, text: string, qrPixels = 300): void {
  const W = 1280;
  const H = 720;
  const y = Buffer.alloc(W * H, 110);
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
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
      const dark = mr >= 0 && mc >= 0 && mr < n && mc < n && qr.modules.data[mr * n + mc];
      y[(top + row) * W + left + col] = dark ? 20 : 235;
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  writeFileSync(
    file,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame, frame, frame, frame]),
  );
}
