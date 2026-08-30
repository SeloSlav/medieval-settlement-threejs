export const LIVE_BATTLE_CAPTURE_QUERY = 'recordBattle';
export const DEFAULT_LIVE_BATTLE_CAPTURE_DURATION_MS = 30_000;
export const DEFAULT_LIVE_BATTLE_CAPTURE_FPS = 60;
export const DEFAULT_LIVE_BATTLE_CAPTURE_BITRATE = 20_000_000;

const LIVE_BATTLE_CAPTURE_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
] as const;

export type LiveBattleCaptureStatus =
  | 'idle'
  | 'recording'
  | 'complete'
  | 'error';

export type LiveBattleCaptureDiagnostics = {
  status: LiveBattleCaptureStatus;
  durationMs: number;
  fps: number;
  bitrate: number;
  mimeType: string | null;
  filename: string;
  startedAt: string | null;
  completedAt: string | null;
  bytes: number;
  error: string | null;
};

export type LiveBattleCaptureResult = {
  blob: Blob;
  url: string;
  diagnostics: LiveBattleCaptureDiagnostics;
};

export type LiveBattleCaptureOptions = {
  durationMs?: number;
  fps?: number;
  bitrate?: number;
  filename?: string;
  autoDownload?: boolean;
};

declare global {
  interface Window {
    __LIVE_BATTLE_CAPTURE_BLOB__?: Blob;
    __LIVE_BATTLE_CAPTURE_URL__?: string;
    __LIVE_BATTLE_CAPTURE_DIAGNOSTICS__?: LiveBattleCaptureDiagnostics;
  }
}

let activeCapture: Promise<LiveBattleCaptureResult> | null = null;
let retainedCaptureUrl: string | null = null;

export function isLiveBattleCaptureRequested(search: string): boolean {
  const requested = new URLSearchParams(search).get(LIVE_BATTLE_CAPTURE_QUERY);
  return requested === '1' || requested === 'true';
}

export function isLiveBattleCaptureEnabled(search: string, development: boolean): boolean {
  return development && isLiveBattleCaptureRequested(search);
}

export function liveBattleCaptureFilename(durationMs: number): string {
  const durationSeconds = Math.max(1, Math.round(durationMs / 1_000));
  return `selo-empire-live-battle-${durationSeconds}s.webm`;
}

/**
 * Records the production renderer canvas only when a development route opts in
 * through `?recordBattle=1`. Importing this module never starts a recording.
 */
export function startLiveBattleCapture(
  canvas: HTMLCanvasElement,
  options: LiveBattleCaptureOptions = {},
): Promise<LiveBattleCaptureResult> {
  if (!isLiveBattleCaptureEnabled(window.location.search, import.meta.env.DEV)) {
    return Promise.reject(new Error(
      `Live battle capture is development-only and requires ?${LIVE_BATTLE_CAPTURE_QUERY}=1.`,
    ));
  }
  if (activeCapture) return activeCapture;

  const durationMs = positiveInteger(
    options.durationMs,
    DEFAULT_LIVE_BATTLE_CAPTURE_DURATION_MS,
  );
  const fps = positiveInteger(options.fps, DEFAULT_LIVE_BATTLE_CAPTURE_FPS);
  const bitrate = positiveInteger(options.bitrate, DEFAULT_LIVE_BATTLE_CAPTURE_BITRATE);
  const filename = options.filename?.trim() || liveBattleCaptureFilename(durationMs);
  const autoDownload = options.autoDownload !== false;

  const diagnostics: LiveBattleCaptureDiagnostics = {
    status: 'idle',
    durationMs,
    fps,
    bitrate,
    mimeType: null,
    filename,
    startedAt: null,
    completedAt: null,
    bytes: 0,
    error: null,
  };
  publishDiagnostics(diagnostics);

  activeCapture = recordCanvas(canvas, diagnostics, autoDownload)
    .catch((error: unknown) => {
      diagnostics.status = 'error';
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.error = error instanceof Error ? error.message : String(error);
      publishDiagnostics(diagnostics);
      throw error;
    })
    .finally(() => {
      activeCapture = null;
    });
  return activeCapture;
}

async function recordCanvas(
  canvas: HTMLCanvasElement,
  diagnostics: LiveBattleCaptureDiagnostics,
  autoDownload: boolean,
): Promise<LiveBattleCaptureResult> {
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('The live battle canvas has no drawable resolution.');
  }
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser does not support canvas video capture.');
  }
  if (typeof MediaRecorder !== 'function') {
    throw new Error('This browser does not support MediaRecorder.');
  }

  const mimeType = LIVE_BATTLE_CAPTURE_MIME_TYPES.find((candidate) => (
    MediaRecorder.isTypeSupported(candidate)
  ));
  if (!mimeType) {
    throw new Error('This browser supports neither VP9 nor VP8 WebM recording.');
  }

  const stream = canvas.captureStream(diagnostics.fps);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: diagnostics.bitrate,
  });
  diagnostics.status = 'recording';
  diagnostics.mimeType = mimeType;
  diagnostics.startedAt = new Date().toISOString();
  publishDiagnostics(diagnostics);

  try {
    await new Promise<void>((resolve, reject) => {
      let stopTimer = 0;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('error', () => {
        window.clearTimeout(stopTimer);
        reject(new Error('The browser stopped the live battle recording unexpectedly.'));
      }, { once: true });
      recorder.addEventListener('stop', () => {
        window.clearTimeout(stopTimer);
        resolve();
      }, { once: true });
      recorder.start(250);
      stopTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, diagnostics.durationMs);
    });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) throw new Error('The live battle recording contained no video data.');

  if (retainedCaptureUrl) URL.revokeObjectURL(retainedCaptureUrl);
  retainedCaptureUrl = URL.createObjectURL(blob);
  window.__LIVE_BATTLE_CAPTURE_BLOB__ = blob;
  window.__LIVE_BATTLE_CAPTURE_URL__ = retainedCaptureUrl;

  diagnostics.status = 'complete';
  diagnostics.completedAt = new Date().toISOString();
  diagnostics.bytes = blob.size;
  publishDiagnostics(diagnostics);

  if (autoDownload) downloadCapture(retainedCaptureUrl, diagnostics.filename);
  return { blob, url: retainedCaptureUrl, diagnostics: { ...diagnostics } };
}

function downloadCapture(url: string, filename: string): void {
  document.getElementById('live-battle-capture-download')?.remove();
  const anchor = document.createElement('a');
  anchor.id = 'live-battle-capture-download';
  anchor.dataset.testid = 'live-battle-capture-download';
  anchor.href = url;
  anchor.download = filename;
  anchor.textContent = 'Download 30s battle capture';
  Object.assign(anchor.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '10000',
    padding: '11px 16px',
    border: '1px solid rgba(219, 178, 67, 0.72)',
    borderRadius: '8px',
    background: 'rgba(18, 20, 17, 0.92)',
    color: '#e4c15b',
    font: '600 13px/1.2 system-ui, sans-serif',
    textDecoration: 'none',
    boxShadow: '0 10px 26px rgba(0, 0, 0, 0.34)',
  });
  document.body.appendChild(anchor);
  anchor.click();
}

function publishDiagnostics(diagnostics: LiveBattleCaptureDiagnostics): void {
  const snapshot = { ...diagnostics };
  window.__LIVE_BATTLE_CAPTURE_DIAGNOSTICS__ = snapshot;
  const root = document.documentElement;
  root.dataset.liveBattleCaptureStatus = snapshot.status;
  root.dataset.liveBattleCaptureDurationMs = String(snapshot.durationMs);
  root.dataset.liveBattleCaptureFps = String(snapshot.fps);
  root.dataset.liveBattleCaptureBitrate = String(snapshot.bitrate);
  root.dataset.liveBattleCaptureMimeType = snapshot.mimeType ?? '';
  root.dataset.liveBattleCaptureFilename = snapshot.filename;
  root.dataset.liveBattleCaptureBytes = String(snapshot.bytes);
  root.dataset.liveBattleCaptureError = snapshot.error ?? '';
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.round(value!) : fallback;
}
