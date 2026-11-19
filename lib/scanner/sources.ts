// Where the kiosk gets codes from. The kiosk screen only knows this
// interface, so the camera can be swapped for a test feed, or one day for
// something else, without touching the screen or the sign-in rules.
import { createDecoder, type DecoderKey } from './decoder';

export interface ScanSource {
  /** What is doing the reading, for the status line. */
  label: string;
  /** Starts reading. Calls onCode every time a code is seen, many times a second. */
  start(onCode: (code: string) => void, video?: HTMLVideoElement | null): Promise<void>;
  stop(): void;
}

/** The front camera and a QR decoder. */
export function cameraSource(pick: DecoderKey | 'auto' = 'auto'): ScanSource {
  let stream: MediaStream | null = null;
  let running = false;
  const source: ScanSource = {
    label: '',
    async start(onCode, video) {
      if (!video) throw new Error('The camera view is missing');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser gives the page no camera');
      const decoder = await createDecoder(pick);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = stream;
      await video.play();
      source.label = decoder.name;
      running = true;
      let busy = false;
      const tick = async () => {
        if (!running) return;
        schedule();
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const text = await decoder.read(video);
          if (text && running) onCode(text);
        } catch {
          // One bad frame is not worth stopping for. The next frame is tried.
        } finally {
          busy = false;
        }
      };
      const schedule = () => {
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => void tick());
        else requestAnimationFrame(() => void tick());
      };
      schedule();
    },
    stop() {
      running = false;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },
  };
  return source;
}

export const TEST_SCAN_EVENT = 'kiosk:test-scan';

/**
 * A stand-in for the camera, for tests on a machine that has none. It hands
 * over whatever code arrives in a "kiosk:test-scan" window event. The server
 * only allows it when KIOSK_TEST_FEED is set, and never in production.
 */
export function testSource(): ScanSource {
  let listener: ((event: Event) => void) | null = null;
  return {
    label: 'test feed',
    async start(onCode) {
      listener = (event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (typeof detail === 'string') onCode(detail);
      };
      window.addEventListener(TEST_SCAN_EVENT, listener);
    },
    stop() {
      if (listener) window.removeEventListener(TEST_SCAN_EVENT, listener);
      listener = null;
    },
  };
}
