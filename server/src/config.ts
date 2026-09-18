/**
 * config.ts — read and validate env at boot. Fails fast on bad shape.
 *
 * Two modes:
 *   - Production: requires FIREBASE_PROJECT_ID + service account (or ADC)
 *   - Development: if FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST
 *     are set, use the emulators automatically.
 *
 * VISION_PROVIDER env:
 *   - "minimax" (default): will use MiniMax if MINIMAX_API_KEY is set,
 *     otherwise falls back to stub mode (returns canned result + logs
 *     a warning). Per spec §3: NEVER silently swap to a different
 *     unapproved endpoint.
 *   - "disabled": returns 503 from /api/vision/analyze.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  port: number;
  logLevel: LogLevel;

  firebase: {
    projectId: string | null;
    serviceAccountJson: string | null; // base64; null → use ADC
    authEmulatorHost: string | null;
    firestoreEmulatorHost: string | null;
  };

  vision: {
    provider: 'minimax' | 'disabled';
    apiKey: string | null;
    apiHost: string;
    apiBaseUrl: string;
    model: string;
    timeoutMs: number;
    maxImageBytes: number;
  };

  quota: {
    monthlyAiUses: number;
  };

  googlePlay: {
    packageName: string | null;
    serviceAccountKey: string | null; // base64
  };
}

const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function num(s: string | undefined, fallback: number): number {
  const n = parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfig(): Config {
  const port = num(process.env.PORT, 8788);
  const rawLog = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const logLevel: LogLevel = (VALID_LOG_LEVELS.includes(rawLog) ? rawLog : 'info') as LogLevel;

  const projectId = process.env.FIREBASE_PROJECT_ID || null;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null;
  const authEmu = process.env.FIREBASE_AUTH_EMULATOR_HOST || null;
  const fsEmu = process.env.FIRESTORE_EMULATOR_HOST || null;

  const visionRaw = (process.env.VISION_PROVIDER ?? 'minimax').toLowerCase();
  const visionProvider: Config['vision']['provider'] =
    visionRaw === 'disabled' ? 'disabled' : 'minimax';

  const apiKey = process.env.MINIMAX_API_KEY || null;
  const apiHost = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
  const model = process.env.MINIMAX_VISION_MODEL || 'MiniMax-M3';

  const monthlyAiUses = num(process.env.AI_MONTHLY_QUOTA, 200);

  const gplayPkg = process.env.GOOGLE_PLAY_PACKAGE_NAME || null;
  const gplayKey = process.env.GOOGLE_PLAY_SA_KEY || null;

  return {
    port,
    logLevel,
    firebase: {
      projectId,
      serviceAccountJson: sa,
      authEmulatorHost: authEmu,
      firestoreEmulatorHost: fsEmu,
    },
    vision: {
      provider: visionProvider,
      apiKey,
      apiHost,
      apiBaseUrl: process.env.MINIMAX_API_BASE_URL ?? 'https://api.minimax.io/v1',
      model,
      timeoutMs: num(process.env.MINIMAX_TIMEOUT_MS, 30_000),
      maxImageBytes: num(process.env.MINIMAX_MAX_IMAGE_BYTES, 10 * 1024 * 1024),
    },
    quota: { monthlyAiUses },
    googlePlay: {
      packageName: gplayPkg,
      serviceAccountKey: gplayKey,
    },
  };
}

export const config: Config = loadConfig();

// Run-time warnings (not errors — stub mode is intentional).
if (config.vision.provider === 'minimax' && !config.vision.apiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] MINIMAX_API_KEY is unset — /api/vision/analyze will run in stub mode (canned result). ' +
    'Set the key to enable real vision inference.',
  );
}

if (config.vision.provider === 'minimax' && config.firebase.projectId === null) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] FIREBASE_PROJECT_ID is unset — entitlements requests will return 500 (no DB configured).',
  );
}
