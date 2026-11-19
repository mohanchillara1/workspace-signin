// One small module that hides which QR decoder is running.
//
//   const decoder = await createDecoder('auto');
//   const text = await decoder.read(video);   // the code's text, or null
//
// 'auto' tries the browser's own BarcodeDetector first, then zxing
// (WebAssembly), then jsQR (plain JavaScript). Nothing is assumed about the
// browser: each is tried, and skipped with a reason if it cannot start.

export type DecoderKey = 'native' | 'zxing' | 'jsqr';

export type Decoder = {
  key: DecoderKey;
  name: string;
  /** Decoders tried first that could not start, and why. */
  skipped: string[];
  read(video: HTMLVideoElement): Promise<string | null>;
};

export const DECODER_ORDER: DecoderKey[] = ['native', 'zxing', 'jsqr'];

const WASM_URL = '/zxing_reader.wasm';
// Longest side, in pixels, of the frame handed to a JavaScript decoder.
const MAX_SIDE = { zxing: 1280, jsqr: 800 };

function frameGrabber(maxSide: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (video: HTMLVideoElement): ImageData | null => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!ctx || !vw || !vh) return null;
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

type NativeDetector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

async function nativeDecoder(): Promise<Omit<Decoder, 'skipped'>> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) throw new Error('this browser has no BarcodeDetector');
  const formats = await Detector.getSupportedFormats();
  if (!formats.includes('qr_code')) throw new Error('BarcodeDetector is here but cannot read QR');
  const detector = new Detector({ formats: ['qr_code'] });
  return {
    key: 'native',
    name: 'built-in reader',
    async read(video) {
      const found = await detector.detect(video);
      return found.length ? found[0].rawValue : null;
    },
  };
}

async function zxingDecoder(): Promise<Omit<Decoder, 'skipped'>> {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  const grab = frameGrabber(MAX_SIDE.zxing);
  return {
    key: 'zxing',
    name: 'zxing',
    async read(video) {
      const frame = grab(video);
      if (!frame) return null;
      const found = await readBarcodes(frame, { formats: ['QRCode'], maxNumberOfSymbols: 1 });
      return found.length && found[0].text ? found[0].text : null;
    },
  };
}

async function jsqrDecoder(): Promise<Omit<Decoder, 'skipped'>> {
  const { default: jsQR } = await import('jsqr');
  const grab = frameGrabber(MAX_SIDE.jsqr);
  return {
    key: 'jsqr',
    name: 'jsQR',
    async read(video) {
      const frame = grab(video);
      if (!frame) return null;
      const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
      return found && found.data ? found.data : null;
    },
  };
}

const MAKERS: Record<DecoderKey, () => Promise<Omit<Decoder, 'skipped'>>> = {
  native: nativeDecoder,
  zxing: zxingDecoder,
  jsqr: jsqrDecoder,
};

export async function createDecoder(pick: DecoderKey | 'auto' = 'auto'): Promise<Decoder> {
  const order = pick === 'auto' ? DECODER_ORDER : [pick];
  const skipped: string[] = [];
  for (const key of order) {
    try {
      return { ...(await MAKERS[key]()), skipped };
    } catch (error) {
      skipped.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No QR decoder could start. ${skipped.join('; ')}`);
}
