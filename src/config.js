import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const CURRENT_API_VERSION = '2026-03-01';
export const SUPPORTED_API_VERSIONS = ['2026-03-01', '2026-02-10'];

export const PLAN_LIMITS = {
  free: { write: 30, read: 120 },
  team: { write: 600, read: 1200 },
  business: { write: 3000, read: 6000 },
};

export function loadConfig(env = process.env) {
  const dataDir = env.HOOKLINE_DATA_DIR
    ? path.resolve(env.HOOKLINE_DATA_DIR)
    : path.join(ROOT, 'data');

  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 4242),
    dataDir,
    databaseFile: env.HOOKLINE_DATABASE ?? path.join(dataDir, 'hookline.db'),
    plan: env.HOOKLINE_PLAN ?? 'free',
    apiVersion: CURRENT_API_VERSION,
    supportedVersions: SUPPORTED_API_VERSIONS,
    testKey: env.HOOKLINE_TEST_KEY ?? 'hl_test_dev',
    liveKey: env.HOOKLINE_LIVE_KEY ?? 'hl_live_dev',
    allowPrivateUrls: env.HOOKLINE_ALLOW_PRIVATE_URLS === '1',
    bodyLimit: 256 * 1024,
    deliveryTimeoutMs: Number(env.HOOKLINE_DELIVERY_TIMEOUT_MS ?? 5000),
    verifyTimeoutMs: Number(env.HOOKLINE_VERIFY_TIMEOUT_MS ?? 5000),
    tickMs: Number(env.HOOKLINE_TICK_MS ?? 1000),
    retryDelaysSeconds: [60, 600, 3600, 21600, 86400],
    maxAttempts: 6,
    disableAfterMs: 7 * 24 * 60 * 60 * 1000,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    cleanupIntervalMs: 60 * 60 * 1000,
    planLimits: PLAN_LIMITS,
    root: ROOT,
  };
}
