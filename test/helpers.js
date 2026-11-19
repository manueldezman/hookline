import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mutableClock } from '../src/clock.js';

export const TEST_KEY = 'hl_test_test';
export const LIVE_KEY = 'hl_live_test';
export const START = Date.parse('2026-03-04T10:12:44Z');

export function makeConfig(overrides = {}) {
  return {
    ...loadConfig({ HOOKLINE_DATA_DIR: '/tmp/hookline-test' }),
    databaseFile: ':memory:',
    testKey: TEST_KEY,
    liveKey: LIVE_KEY,
    allowPrivateUrls: true,
    deliveryTimeoutMs: 50,
    verifyTimeoutMs: 50,
    planLimits: {
      free: { write: 1000, read: 1000 },
      team: { write: 2000, read: 2000 },
      business: { write: 5000, read: 5000 },
    },
    ...overrides,
  };
}

export async function makeApp({ sender, verifier, config = {} } = {}) {
  const clock = mutableClock(START);
  const app = createApp({
    config: makeConfig(config),
    clock,
    sender: sender ?? (async () => ({ status: 200, error: null })),
    verifier: verifier ?? (async () => {}),
  });
  await app.ready();
  return { app, clock };
}

export function auth(key = TEST_KEY) {
  return { authorization: `Bearer ${key}` };
}

export async function call(app, method, url, { key = TEST_KEY, payload, headers = {} } = {}) {
  const response = await app.inject({
    method,
    url,
    headers: { ...auth(key), ...headers },
    payload,
  });
  let body = null;
  if (response.body) {
    try {
      body = response.json();
    } catch {
      body = response.body;
    }
  }
  return { status: response.statusCode, body, headers: response.headers };
}

export async function createEndpoint(app, overrides = {}) {
  return call(app, 'POST', '/v2/endpoints', {
    key: LIVE_KEY,
    payload: {
      url: 'https://example.com/webhooks',
      event_types: ['invoice.paid'],
      ...overrides,
    },
  });
}

export async function createEvent(app, overrides = {}) {
  return call(app, 'POST', '/v2/events', {
    key: LIVE_KEY,
    payload: {
      type: 'invoice.paid',
      payload: { invoiceId: 'inv_1042', amount: 4900, currency: 'USD' },
      ...overrides,
    },
  });
}
