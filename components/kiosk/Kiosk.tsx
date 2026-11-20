'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskCard, TaskGroups } from '@/components/TaskCard';
import { copy } from '@/lib/copy';
import { chicagoTime } from '@/lib/day';
import { DIM_BRIGHTNESS, dimShift, shouldDim, shouldReload } from '@/lib/kiosk-wall';
import { cameraSource, testSource, type ScanSource } from '@/lib/scanner/sources';
import type { Handout } from '@/lib/tasks';

type Phase = 'idle' | 'loading' | 'hello' | 'unknown' | 'slow' | 'offline' | 'error' | 'not_paired';
type Hello = { code: string; firstName: string; name: string; firstToday: boolean; tasks: Handout[] | null };
type Camera = 'starting' | 'on' | 'blocked';

// After a result leaves the screen, the same code is ignored until it has been
// out of the camera's view for this long. Otherwise a phone still held up
// would sign in again and again.
const CLEAR_MS = 2000;
// Messages with nothing to tap go away sooner than a task list.
const SHORT_MESSAGE_SECONDS = 5;
// A request that has not answered by now is treated as no connection, so the
// kiosk can never sit waiting for good.
const REQUEST_TIMEOUT_MS = 8000;
// How often an idle kiosk asks whether the site has a newer build.
const BUILD_CHECK_MS = 60_000;
// Where the time of the last self-reload is kept, so a reload cannot loop.
const RELOADED_AT = 'kiosk-reloaded-at';
// The note about the screen going to sleep is for the lead setting the iPad
// up, so it shows for the first two minutes only.
const WAKE_NOTE_MS = 120_000;

type Wake = 'on' | 'off' | 'none';
type WakeLock = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void };

const k = copy.kiosk;

async function post(path: string, data: unknown): Promise<Response> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      cache: 'no-store',
      signal: control.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function Kiosk({
  idleSeconds,
  testFeed,
  kioskName,
  testCopy = false,
  build = '',
  dimAfterSeconds = 3600,
}: {
  idleSeconds: number;
  testFeed: boolean;
  kioskName: string;
  testCopy?: boolean;
  /** The build of the site this screen was drawn with. */
  build?: string;
  /** Seconds with no scan and no touch before the idle screen dims. 0 means never. */
  dimAfterSeconds?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [hello, setHelloState] = useState<Hello | null>(null);
  const [camera, setCamera] = useState<Camera>('starting');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lastRead, setLastRead] = useState<Date | null>(null);
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);
  // True once this screen is listening for codes. Tests wait for it.
  const [ready, setReady] = useState(false);

  // The scan callback runs outside React's render cycle, so what it needs to
  // know about the screen lives in refs.
  const phaseRef = useRef<Phase>('idle');
  const helloRef = useRef<Hello | null>(null);
  const busyRef = useRef(false);
  const deadlineRef = useRef(0);
  const shownCodeRef = useRef<string | null>(null);
  const suppressRef = useRef<{ code: string; until: number } | null>(null);
  const cameraRef = useRef<ScanSource | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  // A wall device: awake, dim when quiet, and back by itself after trouble.
  const [wake, setWake] = useState<Wake>('off');
  const [wakeNote, setWakeNote] = useState(true);
  const [dim, setDim] = useState(false);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [crashed, setCrashed] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const reloadedRef = useRef(0);
  const cameraStateRef = useRef<Camera>('starting');
  const setCameraState = useCallback((next: Camera) => {
    cameraStateRef.current = next;
    setCamera(next);
  }, []);
  /** Someone is here: a code in view or a touch. The screen comes out of dim at once. */
  const active = useCallback(() => {
    lastActivityRef.current = Date.now();
    setDim(false);
  }, []);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const setHello = useCallback((next: Hello | null) => {
    helloRef.current = next;
    setHelloState(next);
  }, []);

  const startClock = useCallback((seconds: number) => {
    deadlineRef.current = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
  }, []);

  const toIdle = useCallback(() => {
    if (shownCodeRef.current) suppressRef.current = { code: shownCodeRef.current, until: Date.now() + CLEAR_MS };
    shownCodeRef.current = null;
    deadlineRef.current = 0;
    setHello(null);
    setNote('');
    setPhase('idle');
  }, [setHello, setPhase]);

  const goOffline = useCallback(() => {
    shownCodeRef.current = null;
    deadlineRef.current = 0;
    setHello(null);
    setPhase('offline');
  }, [setHello, setPhase]);

  /** What every answer from the server has to pass: paired, reachable, working. */
  const readAnswer = useCallback(
    async (response: Response): Promise<Record<string, unknown> | null> => {
      if (response.status === 401) {
        setPhase('not_paired');
        return null;
      }
      // The server is up but cannot do its job (its database is away, say).
      // The health check asks the database too, so the kiosk stays on this
      // message until sign-ins can work again.
      if (response.status >= 500) {
        goOffline();
        return null;
      }
      try {
        return (await response.json()) as Record<string, unknown>;
      } catch {
        goOffline();
        return null;
      }
    },
    [goOffline, setPhase],
  );

  const submit = useCallback(
    async (code: string) => {
      busyRef.current = true;
      shownCodeRef.current = code;
      setNote('');
      if (phaseRef.current === 'idle') setPhase('loading');
      try {
        const result = await readAnswer(await post('/api/kiosk/scan', { code }));
        if (!result) return;
        setLastRead(new Date());
        if (result.status === 'ok') {
          setHello({
            code,
            firstName: String(result.firstName),
            name: String(result.name),
            firstToday: result.firstToday === true,
            tasks: (result.tasks as Handout[] | null) ?? null,
          });
          setPhase('hello');
          startClock(idleSeconds);
        } else {
          setHello(null);
          setPhase(result.status === 'unknown' ? 'unknown' : result.status === 'slow_down' ? 'slow' : 'error');
          startClock(Math.min(idleSeconds, SHORT_MESSAGE_SECONDS));
        }
      } catch {
        goOffline();
      } finally {
        busyRef.current = false;
      }
    },
    [goOffline, idleSeconds, readAnswer, setHello, setPhase, startClock],
  );

  const onCode = useCallback(
    (code: string) => {
      active();
      const now = Date.now();
      const suppressed = suppressRef.current;
      if (suppressed && suppressed.code === code && now < suppressed.until) {
        suppressed.until = now + CLEAR_MS;
        return;
      }
      if (busyRef.current) return;
      const current = phaseRef.current;
      if (current === 'offline' || current === 'not_paired') return;
      if (shownCodeRef.current === code && current !== 'idle') {
        // Still the same phone. Treat it as the person still being here.
        if (current === 'hello') startClock(idleSeconds);
        return;
      }
      void submit(code);
    },
    [active, idleSeconds, startClock, submit],
  );

  const startCamera = useCallback(async () => {
    setCameraState('starting');
    cameraRef.current?.stop();
    const source = cameraSource();
    cameraRef.current = source;
    try {
      // If the camera is taken away later, start it again after a moment.
      await source.start(onCode, videoRef.current, () => {
        if (cameraRef.current !== source) return;
        setCameraState('starting');
        setTimeout(() => void startCameraRef.current(), 1000);
      });
      setCameraState('on');
    } catch {
      setCameraState('blocked');
    }
  }, [onCode, setCameraState]);
  const startCameraRef = useRef(startCamera);
  startCameraRef.current = startCamera;

  // Start reading once. In a test run the test feed listens alongside the camera.
  useEffect(() => {
    void post('/api/kiosk/hello', {}).catch(() => {});
    void startCamera();
    const feed = testFeed ? testSource() : null;
    void feed?.start(onCode);
    // A test-only door, like the test feed: makes this screen throw, to prove it comes back.
    const crash = () => setCrashed(true);
    if (testFeed) window.addEventListener('kiosk:test-crash', crash);
    // Back in view with no camera running (the iPad was locked, say): start it again.
    const seen = () => {
      if (document.visibilityState === 'visible' && cameraStateRef.current === 'blocked') void startCameraRef.current();
    };
    document.addEventListener('visibilitychange', seen);
    setReady(true);
    return () => {
      cameraRef.current?.stop();
      feed?.stop();
      window.removeEventListener('kiosk:test-crash', crash);
      document.removeEventListener('visibilitychange', seen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock that sends the screen back to "Scan your code".
  useEffect(() => {
    const timer = setInterval(() => {
      if (!deadlineRef.current) return;
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      if (left <= 0) toIdle();
      else setSecondsLeft(left);
    }, 250);
    return () => clearInterval(timer);
  }, [toIdle]);

  // Connection: say so when it drops, and come back when it returns.
  useEffect(() => {
    const check = async () => {
      if (phaseRef.current !== 'offline') return;
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (response.ok) toIdle();
      } catch {
        // Still offline.
      }
    };
    const down = () => goOffline();
    const up = () => void check();
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    const timer = setInterval(check, 3000);
    if (!navigator.onLine) goOffline();
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
      clearInterval(timer);
    };
  }, [goOffline, toIdle]);

  // Keep the screen on, where the browser allows it. The lock is lost when the
  // page is hidden, so it is asked for again when the page is back, on a touch
  // (some browsers only grant it then), and once a minute.
  useEffect(() => {
    const locks = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } }).wakeLock;
    const noteTimer = setTimeout(() => setWakeNote(false), WAKE_NOTE_MS);
    if (!locks) {
      setWake('none');
      return () => clearTimeout(noteTimer);
    }
    let lock: WakeLock | null = null;
    let asking = false;
    let gone = false;
    const ask = async () => {
      if (gone || asking || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      asking = true;
      try {
        const got = await locks.request('screen');
        lock = got;
        got.addEventListener('release', () => {
          if (lock === got && !gone) setWake('off');
        });
        if (!gone) setWake('on');
      } catch {
        if (!gone) setWake('off');
      } finally {
        asking = false;
      }
    };
    const again = () => void ask();
    void ask();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pointerdown', again);
    const timer = setInterval(again, 60_000);
    return () => {
      gone = true;
      clearTimeout(noteTimer);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('pointerdown', again);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Dim the idle screen after a quiet stretch. The camera keeps reading, so a
  // code held up to it wakes the screen like a touch does.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const next = shouldDim({ phase: phaseRef.current, quietForMs: now - lastActivityRef.current, dimAfterMs: dimAfterSeconds * 1000 });
      setDim(next);
      if (next) setShift(dimShift(now));
    }, 5000);
    return () => clearInterval(timer);
  }, [dimAfterSeconds]);

  // After the site is updated, an idle kiosk reloads itself. It asks the
  // server first, so it never reloads into a browser error page.
  useEffect(() => {
    const check = async () => {
      if (phaseRef.current !== 'idle') return;
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const body = response.ok ? ((await response.json()) as { build?: unknown }) : null;
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0) || 0;
        } catch {
          // No storage: reload at most once, then leave it to a person.
          last = reloadedRef.current;
        }
        const go = shouldReload({
          healthOk: response.ok,
          serverBuild: typeof body?.build === 'string' ? body.build : '',
          ownBuild: build,
          phase: phaseRef.current,
          lastReloadAt: last,
          now: Date.now(),
        });
        if (!go) return;
        reloadedRef.current = Date.now();
        try {
          sessionStorage.setItem(RELOADED_AT, String(Date.now()));
        } catch {
          // Kept in memory above.
        }
        window.location.reload();
      } catch {
        // No connection. The check below says so on the screen.
      }
    };
    const timer = setInterval(() => void check(), BUILD_CHECK_MS);
    return () => clearInterval(timer);
  }, [build]);

  // Tell people when the task list runs past the bottom of the screen.
  const measure = useCallback(() => {
    const list = listRef.current;
    setMoreBelow(!!list && list.scrollHeight - list.scrollTop - list.clientHeight > 24);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, hello, phase]);

  const touched = () => {
    active();
    if (phaseRef.current === 'hello') startClock(idleSeconds);
  };

  const act = async (path: string, data: Record<string, unknown>, failNote: string) => {
    const current = helloRef.current;
    if (!current || acting) return;
    setActing(true);
    startClock(idleSeconds);
    try {
      const result = await readAnswer(await post(path, { code: current.code, ...data }));
      // The answer belongs to whoever was on screen when it was asked. If
      // someone else has scanned since, it is dropped.
      if (result && result.status === 'ok' && helloRef.current?.code === current.code) {
        setHello({ ...current, tasks: (result.tasks as Handout[] | null) ?? null });
        setNote(result.changed ? (result.state === 'submitted' ? copy.submit.kioskWaiting : '') : failNote);
        listRef.current?.scrollTo({ top: 0 });
      }
    } catch {
      goOffline();
    } finally {
      setActing(false);
    }
  };

  // Thrown while drawing, so the page's error screen takes over and reloads.
  if (crashed) throw new Error('The kiosk screen was made to fail by a test');

  const showCameraBig = phase === 'idle' || phase === 'loading';
  const trouble = phase === 'unknown' || phase === 'slow' || phase === 'error' || phase === 'offline';
  const status =
    (phase === 'offline' ? k.statusOffline : k.statusOnline) +
    ' ' +
    (lastRead ? k.statusLastRead(chicagoTime(lastRead)) : k.statusNoRead);

  if (phase === 'not_paired') {
    return (
      <main data-testid="kiosk" data-phase={phase} className="flex min-h-dvh items-center justify-center p-8">
        <div className="max-w-xl">
          <h1 className="text-5xl">{k.notPairedTitle}</h1>
          <p className="mt-4 text-xl text-paper/85">{k.notPairedBody}</p>
          <a href="/admin" className="btn-pill mt-8 bg-arcade-fuel text-ink">
            {k.notPairedLink}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="kiosk"
      data-phase={phase}
      data-ready={ready ? '1' : '0'}
      data-wake={wake}
      data-dim={dim ? '1' : '0'}
      data-camera={camera}
      data-build={build}
      onPointerDown={touched}
      // Dim is dimmer, not dark: "Scan your code" can still be read.
      style={dim ? { filter: `brightness(${DIM_BRIGHTNESS})` } : undefined}
      className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden transition-[filter] duration-700"
    >
      <div
        className={
          showCameraBig
            ? 'grid min-h-0 gap-8 p-8 pb-12 landscape:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] landscape:items-center portrait:grid-rows-[auto_minmax(0,1fr)]'
            : 'grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-6 p-8 pb-0'
        }
      >
        {/* The camera view stays mounted in every state, so the next person
            can scan while the last one is still reading their tasks. */}
        <div
          className={
            showCameraBig
              ? 'relative h-full min-h-0 w-full -rotate-1 portrait:order-2 landscape:max-h-[46rem]'
              : 'flex items-start gap-6'
          }
        >
          <div className={`sticker-frame relative overflow-hidden ${showCameraBig ? 'h-full w-full' : 'aspect-[4/3] w-44 shrink-0 -rotate-2'}`}>
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full -scale-x-100 rounded-md bg-ink object-cover" />
            {camera !== 'on' && showCameraBig && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-md bg-ink p-6 text-center text-paper">
                <p className="max-w-sm text-xl">{camera === 'starting' ? k.cameraStarting : k.cameraBlocked}</p>
                {camera === 'blocked' && (
                  <button type="button" onClick={() => void startCamera()} className="btn-pill bg-arcade-fuel text-ink">
                    {k.cameraButton}
                  </button>
                )}
              </div>
            )}
          </div>
          {showCameraBig && (
            <p className="absolute -bottom-5 left-6 rotate-1 rounded-full border-2 border-ink bg-arcade-fuel px-5 py-2 text-xl font-bold text-ink shadow-hard-sm">
              {k.cameraHint}
            </p>
          )}

          {phase === 'hello' && hello && (
            <div className="min-w-0">
              <h1 className="text-7xl leading-none">{k.hello(hello.firstName)}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full border-2 border-ink bg-arcade-mint px-5 py-1 text-2xl font-bold text-ink">
                  {hello.firstToday ? k.signedIn : k.signedInAgain}
                </span>
                {/* First name and last initial, so two people with one first
                    name can see whose sign-in this is. */}
                <span data-testid="kiosk-name" className="text-2xl text-paper/80">{hello.name}</span>
              </p>
            </div>
          )}
          {trouble && (
            <div className="min-w-0 max-w-3xl rounded-xl border-2 border-ink bg-arcade-bumper p-6 text-paper shadow-hard">
              <h1 className="text-6xl leading-none">
                {phase === 'unknown' ? k.unknownTitle : phase === 'slow' ? k.slowTitle : phase === 'offline' ? k.offlineTitle : k.errorTitle}
              </h1>
              <p className="mt-4 text-3xl">
                {phase === 'unknown' ? k.unknownBody : phase === 'slow' ? k.slowBody : phase === 'offline' ? k.offlineBody : k.errorBody}
              </p>
            </div>
          )}
        </div>

        {showCameraBig && (
          <div
            className="portrait:order-1 portrait:text-center"
            // While dim the words move a few pixels now and then, so they do not rest on one spot.
            style={dim ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : undefined}
          >
            <h1 className="text-7xl leading-[0.95] landscape:text-8xl">{phase === 'loading' ? k.reading : k.idleTitle}</h1>
            <p className="mt-5 text-3xl text-paper/80">{k.idleHint}</p>
          </div>
        )}

        {phase === 'hello' && hello && (
          <div ref={listRef} onScroll={measure} className="min-h-0 overflow-y-auto pb-6 pr-2">
            {/* At the top, so it is seen even when the list is long. */}
            {note && (
              <p role="status" data-testid="kiosk-note" className="mb-4 max-w-3xl text-2xl font-bold text-arcade-fuel">
                {note}
              </p>
            )}
            {hello.tasks === null ? (
              <div className="card max-w-3xl p-6">
                <h2 className="text-3xl">{k.tasksFailedTitle}</h2>
                <p className="mt-2 text-xl">{k.tasksFailedBody}</p>
              </div>
            ) : hello.tasks.length === 0 ? (
              <div className="card max-w-3xl p-6">
                <h2 className="text-3xl">{k.nothingTitle}</h2>
                <p className="mt-2 text-xl">{k.nothingBody}</p>
              </div>
            ) : (
              <TaskGroups
                tasks={hello.tasks}
                size="kiosk"
                render={(handout) => (
                  <TaskCard
                    key={handout.key}
                    handout={handout}
                    size="kiosk"
                    busy={acting}
                    onTake={() => void act('/api/kiosk/claim', { taskId: handout.taskId }, k.taken)}
                    onPutBack={
                      handout.assignmentId
                        ? () => void act('/api/kiosk/giveback', { assignmentId: handout.assignmentId }, '')
                        : undefined
                    }
                    onDone={() =>
                      void act('/api/kiosk/done', { taskId: handout.taskId, assignmentId: handout.assignmentId }, k.taken)
                    }
                  />
                )}
              />
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t-2 border-paper/20 px-8 py-3">
        <p data-testid="kiosk-status" className="text-lg text-paper/75">
          {status}
        </p>
        {wake !== 'on' && wakeNote && (
          <p data-testid="kiosk-wake" className="text-lg text-paper/75">
            {k.wakeOff}
          </p>
        )}
        {testCopy && (
          <p data-testid="test-copy" className="flex items-center gap-3 text-lg text-paper/75">
            <span className="chip chip-kiosk !bg-arcade-fuel">{copy.testCopy.tag}</span>
            <span>{copy.testCopy.kiosk}</span>
          </p>
        )}
        {/* In the bar, not over the list, so it never covers a task. */}
        {phase === 'hello' && moreBelow && (
          <p data-testid="more-below" className="rounded-full border-2 border-ink bg-arcade-fuel px-4 py-1 text-lg font-bold text-ink">
            {k.moreBelow}
          </p>
        )}
        {phase === 'hello' ? (
          <div className="flex items-center gap-4">
            <p className="text-lg text-paper/75">{k.backIn(secondsLeft)}</p>
            <button type="button" onClick={toIdle} className="btn-small !text-base">
              {k.backNow}
            </button>
          </div>
        ) : (
          <p className="text-lg text-paper/70">{kioskName}</p>
        )}
      </footer>
    </main>
  );
}
