import { createDecoder, DECODER_ORDER } from './decoder.js';
import { TEST_CODE } from './shared.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const els = {
  status: $('status'),
  code: $('code'),
  match: $('match'),
  first: $('first'),
  last: $('last'),
  decoder: $('decoder'),
  stats: $('stats'),
  start: $('start'),
  panel: $('panel'),
};

const params = new URLSearchParams(location.search);
const wanted = params.get('decoder');
const pick = DECODER_ORDER.includes(wanted) ? wanted : 'auto';

// After a read, the page waits for the code to leave the view for this long
// before it says "Ready" again and restarts the clock.
const CLEAR_MS = 1500;

const state = {
  decoder: null,
  cameraStartedAt: 0,
  firstReadMs: null,
  armedAt: 0,
  armed: true,
  lastSeenAt: 0,
  scans: 0,
  reads: 0,
  scanMsTotal: 0,
  recent: [],
  busy: false,
};

const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;

function showStatus(text, kind) {
  els.status.textContent = text;
  els.panel.dataset.kind = kind;
}

function showStats() {
  const now = performance.now();
  state.recent = state.recent.filter((t) => now - t < 2000);
  const perSecond = state.recent.length / 2;
  const average = state.scans ? state.scanMsTotal / state.scans : 0;
  els.stats.dataset.scans = String(state.scans);
  els.stats.textContent =
    `Camera ${video.videoWidth} × ${video.videoHeight}. ` +
    `${perSecond.toFixed(0)} scans a second, ${average.toFixed(0)} ms each. ` +
    `${state.reads} read${state.reads === 1 ? '' : 's'} so far.`;
}

function onRead(text, now) {
  state.lastSeenAt = now;
  if (!state.armed) return;
  state.armed = false;
  state.reads++;
  if (state.firstReadMs === null) {
    state.firstReadMs = now - state.cameraStartedAt;
    els.first.textContent = `First read took ${seconds(state.firstReadMs)} from the camera turning on.`;
  }
  els.last.textContent = `This read came ${seconds(now - state.armedAt)} after the screen said Ready.`;
  els.code.textContent = text;
  els.code.dataset.read = '1';
  els.match.textContent = text === TEST_CODE ? 'That is the test code.' : 'That is not the test code.';
  showStatus('Read', 'read');
}

function onNothing(now) {
  if (state.armed) return;
  if (now - state.lastSeenAt < CLEAR_MS) return;
  state.armed = true;
  state.armedAt = now;
  showStatus('Ready. Hold a code up.', 'ready');
}

async function scanOnce() {
  if (state.busy || video.readyState < 2) return;
  state.busy = true;
  const before = performance.now();
  try {
    const text = await state.decoder.read(video);
    const now = performance.now();
    state.scans++;
    state.scanMsTotal += now - before;
    state.recent.push(now);
    if (text) onRead(text, now);
    else onNothing(now);
  } catch (error) {
    showStatus(`The decoder stopped: ${error && error.message ? error.message : error}`, 'error');
  } finally {
    state.busy = false;
  }
}

function loop() {
  scanOnce();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

async function startCamera() {
  els.start.hidden = true;
  showStatus('Turning the camera on…', 'wait');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus('This browser gives web pages no camera. The page has to be opened over https.', 'error');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    showStatus(`The camera did not turn on (${error && error.name ? error.name : error}). Allow the camera for this page, then tap the button.`, 'error');
    els.start.hidden = false;
    return;
  }
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    showStatus('Tap the button to start the camera view.', 'error');
    els.start.hidden = false;
    return;
  }
  state.cameraStartedAt = performance.now();
  state.armedAt = state.cameraStartedAt;
  showStatus('Ready. Hold a code up.', 'ready');
  loop();
  setInterval(showStats, 500);
}

async function main() {
  els.start.addEventListener('click', startCamera);
  try {
    state.decoder = await createDecoder(pick, { wasmUrl: '/assets/zxing_reader.wasm' });
  } catch (error) {
    els.decoder.textContent = 'No decoder is running.';
    showStatus(String(error && error.message ? error.message : error), 'error');
    return;
  }
  const skipped = state.decoder.skipped.length ? ` Skipped: ${state.decoder.skipped.join('; ')}.` : '';
  const forced = pick === 'auto' ? '' : ' (forced by the link)';
  els.decoder.textContent = `Decoder: ${state.decoder.name}${forced}.${skipped}`;
  await startCamera();
}

main();
