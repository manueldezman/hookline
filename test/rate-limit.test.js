import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, createEndpoint } from './helpers.js';

const planLimits = {
  free: { write: 2, read: 2 },
  team: { write: 2, read: 2 },
  business: { write: 2, read: 2 },
};

test('writes over the limit return 429 with Retry-After', async () => {
  const { app, clock } = await makeApp({ config: { planLimits } });
  const body = { url: 'https://example.com', event_types: ['invoice.paid'] };

  const first = await call(app, 'POST', '/v2/endpoints', {
    key: 'hl_live_test',
    payload: body,
  });
  assert.equal(first.status, 201);
  assert.equal(first.headers['x-ratelimit-limit'], '2');
  assert.equal(first.headers['x-ratelimit-remaining'], '1');

  const second = await call(app, 'POST', '/v2/endpoints', {
    key: 'hl_live_test',
    payload: body,
  });
  assert.equal(second.status, 201);
  assert.equal(second.headers['x-ratelimit-remaining'], '0');

  const third = await call(app, 'POST', '/v2/endpoints', {
    key: 'hl_live_test',
    payload: body,
  });
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'rate_limited');
  assert.ok(Number(third.headers['retry-after']) >= 1);

  clock.advance(60_000);
  const fourth = await call(app, 'POST', '/v2/endpoints', {
    key: 'hl_live_test',
    payload: body,
  });
  assert.equal(fourth.status, 201);
  await app.close();
});

test('reads use a separate counter', async () => {
  const { app } = await makeApp({ config: { planLimits } });
  const first = await call(app, 'GET', '/v2/endpoints');
  const second = await call(app, 'GET', '/v2/endpoints');
  const third = await call(app, 'GET', '/v2/endpoints');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);

  const write = await call(app, 'POST', '/v2/endpoints', {
    key: 'hl_live_test',
    payload: { url: 'https://example.com', event_types: [] },
  });
  assert.equal(write.status, 201);
  await app.close();
});

test('unauthenticated requests do not consume the window', async () => {
  const { app } = await makeApp({ config: { planLimits } });
  for (let i = 0; i < 5; i += 1) {
    const response = await app.inject({ method: 'GET', url: '/v2/endpoints' });
    assert.equal(response.statusCode, 401);
  }
  const allowed = await call(app, 'GET', '/v2/endpoints');
  assert.equal(allowed.status, 200);
  const stillAllowed = await call(app, 'GET', '/v2/endpoints');
  assert.equal(stillAllowed.status, 200);
  await app.close();
});

test('an endpoint check confirms the header contract for a read', async () => {
  const { app } = await makeApp();
  await createEndpoint(app);
  const response = await call(app, 'GET', '/v2/endpoints');
  assert.match(response.headers['x-ratelimit-reset'], /^\d+$/);
  assert.equal(response.headers['x-ratelimit-limit'], '1000');
  await app.close();
});
