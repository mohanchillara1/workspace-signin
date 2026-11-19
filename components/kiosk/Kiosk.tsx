'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskCard, TaskGroups } from '@/components/TaskCard';
import { copy } from '@/lib/copy';
import { chicagoTime } from '@/lib/day';
import { cameraSource, testSource, type ScanSource } from '@/lib/scanner/sources';
import type { Handout } from '@/lib/tasks';

type Phase = 'idle' | 'loading' | 'hello' | 'unknown' | 'slow' | 'offline' | 'error' | 'not_paired';
type Hello = { code: string; firstName: string; firstToday: boolean; tasks: Handout[] | null };
type Camera = 'starting' | 'on' | 'blocked';

// After a result leaves the screen, the same code is ignored until it has been
// out of the camera's view for this long. Otherwise a phone still held up
// would sign in again and again.
const CLEAR_MS = 2000;
// Messages with nothing to tap go away sooner than a task list.
const SHORT_MESSAGE_SECONDS = 5;

const k = copy.kiosk;

async function post(path: string, data: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
    cache: 'no-store',
  });
}

export function Kiosk({
  idleSeconds,
  testFeed,
  kioskName,
}: {
  idleSeconds: number;
  testFeed: boolean;
  kioskName: string;
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

  const submit = useCallback(
    async (code: string) => {
      busyRef.current = true;
      shownCodeRef.current = code;
      setNote('');
      if (phaseRef.current === 'idle') setPhase('loading');
      try {
        const response = await post('/api/kiosk/scan', { code });
        if (response.status === 401) {
          setPhase('not_paired');
          return;
        }
        const result = await response.json();
        setLastRead(new Date());
        if (result.status === 'ok') {
          setHello({ code, firstName: result.firstName, firstToday: result.firstToday, tasks: result.tasks });
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
    [goOffline, idleSeconds, setHello, setPhase, startClock],
  );

  const onCode = useCallback(
    (code: string) => {
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
    [idleSeconds, startClock, submit],
  );

  const startCamera = useCallback(async () => {
    setCamera('starting');
    cameraRef.current?.stop();
    const source = cameraSource();
    cameraRef.current = source;
    try {
      await source.start(onCode, videoRef.current);
      setCamera('on');
    } catch {
      setCamera('blocked');
    }
  }, [onCode]);

  // Start reading once. In a test run the test feed listens alongside the camera.
  useEffect(() => {
    void post('/api/kiosk/hello', {}).catch(() => {});
    void startCamera();
    const feed = testFeed ? testSource() : null;
    void feed?.start(onCode);
    setReady(true);
    return () => {
      cameraRef.current?.stop();
      feed?.stop();
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
    if (phaseRef.current === 'hello') startClock(idleSeconds);
  };

  const act = async (path: string, data: Record<string, unknown>, failNote: string) => {
    const current = helloRef.current;
    if (!current || acting) return;
    setActing(true);
    startClock(idleSeconds);
    try {
      const response = await post(path, { code: current.code, ...data });
      if (response.status === 401) {
        setPhase('not_paired');
        return;
      }
      const result = await response.json();
      if (result.status === 'ok' && helloRef.current?.code === current.code) {
        setHello({ ...current, tasks: result.tasks });
        setNote(result.changed ? '' : failNote);
      }
    } catch {
      goOffline();
    } finally {
      setActing(false);
    }
  };

  const showCameraBig = phase === 'idle' || phase === 'loading';
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
          <a href="/login" className="btn-pill mt-8 bg-arcade-fuel text-ink">
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
      onPointerDown={touched}
      className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
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
            <p className="absolute -bottom-5 left-6 rotate-1 rounded-full border-2 border-ink bg-arcade-fuel px-5 py-2 text-xl font-extrabold text-ink shadow-hard-sm">
              {k.cameraHint}
            </p>
          )}

          {phase === 'hello' && hello && (
            <div className="min-w-0">
              <h1 className="text-7xl leading-none">{k.hello(hello.firstName)}</h1>
              <p className="mt-3 inline-block rounded-full border-2 border-ink bg-arcade-mint px-5 py-1 text-2xl font-extrabold text-ink">
                {hello.firstToday ? k.signedIn : k.signedInAgain}
              </p>
            </div>
          )}
          {(phase === 'unknown' || phase === 'slow' || phase === 'error' || phase === 'offline') && (
            <div className="min-w-0">
              <h1 className="text-6xl leading-none">
                {phase === 'unknown' ? k.unknownTitle : phase === 'slow' ? k.slowTitle : phase === 'offline' ? k.offlineTitle : k.errorTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-3xl text-paper/85">
                {phase === 'unknown' ? k.unknownBody : phase === 'slow' ? k.slowBody : phase === 'offline' ? k.offlineBody : k.errorBody}
              </p>
            </div>
          )}
        </div>

        {showCameraBig && (
          <div className="portrait:order-1 portrait:text-center">
            <h1 className="text-7xl leading-[0.95] landscape:text-8xl">{phase === 'loading' ? k.reading : k.idleTitle}</h1>
            <p className="mt-5 text-3xl text-paper/80">{k.idleHint}</p>
          </div>
        )}

        {phase === 'hello' && hello && (
          <div ref={listRef} onScroll={measure} className="relative min-h-0 overflow-y-auto pb-6 pr-2">
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
                    onDone={() =>
                      void act('/api/kiosk/done', { taskId: handout.taskId, assignmentId: handout.assignmentId }, k.taken)
                    }
                  />
                )}
              />
            )}
            {note && <p className="mt-4 text-xl font-bold text-arcade-fuel">{note}</p>}
            {moreBelow && (
              <p className="pointer-events-none sticky bottom-2 mt-2 flex justify-center">
                <span className="rounded-full border-2 border-ink bg-paper px-4 py-1 text-base font-extrabold text-ink shadow-hard-purple">
                  {k.moreBelow}
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t-2 border-paper/20 px-8 py-3">
        <p data-testid="kiosk-status" className="text-base text-paper/70">
          {status}
        </p>
        {phase === 'hello' ? (
          <div className="flex items-center gap-4">
            <p className="text-base text-paper/70">{k.backIn(secondsLeft)}</p>
            <button type="button" onClick={toIdle} className="btn-small">
              {k.finishedHere}
            </button>
          </div>
        ) : (
          <p className="text-base text-paper/50">{kioskName}</p>
        )}
      </footer>
    </main>
  );
}
