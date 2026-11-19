// One small module that hides which QR decoder is running.
//
//   const decoder = await createDecoder('auto', { wasmUrl });
//   const text = await decoder.read(video);   // the code's text, or null
//
// 'auto' tries the browser's own BarcodeDetector first, then zxing (WebAssembly),
// then jsQR (plain JavaScript). Nothing is assumed about the browser: each one
// is tried and skipped with a reason if it can't start.
import jsQR from 'jsqr';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

// Longest side, in pixels, of the frame handed to a JavaScript decoder.
const MAX_SIDE = { zxing: 1280, jsqr: 800 };

function frameGrabber(maxSide) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };
}

async function nativeDecoder() {
  if (!('BarcodeDetector' in globalThis)) throw new Error('this browser has no BarcodeDetector');
  const formats = await globalThis.BarcodeDetector.getSupportedFormats();
  if (!formats.includes('qr_code')) throw new Error('BarcodeDetector is here but cannot read QR');
  const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
  return {
    name: 'BarcodeDetector (built into the browser)',
    async read(video) {
      const found = await detector.detect(video);
      return found.length ? found[0].rawValue : null;
    },
  };
}

async function zxingDecoder(wasmUrl) {
  await prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) => (path.endsWith('.wasm') && wasmUrl ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  });
  const grab = frameGrabber(MAX_SIDE.zxing);
  return {
    name: 'zxing (WebAssembly)',
    async read(video) {
      const frame = grab(video);
      if (!frame) return null;
      const found = await readBarcodes(frame, { formats: ['QRCode'], maxNumberOfSymbols: 1 });
      return found.length && found[0].text ? found[0].text : null;
    },
  };
}

async function jsqrDecoder() {
  const grab = frameGrabber(MAX_SIDE.jsqr);
  return {
    name: 'jsQR (JavaScript)',
    async read(video) {
      const frame = grab(video);
      if (!frame) return null;
      const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
      return found && found.data ? found.data : null;
    },
  };
}

const MAKERS = {
  native: () => nativeDecoder(),
  zxing: (options) => zxingDecoder(options.wasmUrl),
  jsqr: () => jsqrDecoder(),
};

export const DECODER_ORDER = ['native', 'zxing', 'jsqr'];

// pick: 'auto', or one of DECODER_ORDER to force it.
// Returns { name, read, skipped } where skipped lists the decoders that were
// tried first and why each could not start.
export async function createDecoder(pick = 'auto', options = {}) {
  const order = pick === 'auto' ? DECODER_ORDER : [pick];
  const skipped = [];
  for (const key of order) {
    if (!MAKERS[key]) {
      skipped.push(`${key}: not a decoder this page knows`);
      continue;
    }
    try {
      const decoder = await MAKERS[key](options);
      return { ...decoder, key, skipped };
    } catch (error) {
      skipped.push(`${key}: ${error && error.message ? error.message : error}`);
    }
  }
  throw new Error(`No QR decoder could start. ${skipped.join('; ')}`);
}
