import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, TEST_KEY, LIVE_KEY } from './helpers.js';

test('health is public', async () => {
  const { app } = await makeApp();
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  await app.close();
});

test('missing key returns invalid_api_key', async () => {
  const { app } = await makeApp();
  const response = await app.inject({ method: 'GET', url: '/v2/account' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'invalid_api_key');
  assert.match(response.json().error.request_id, /^req_/);
  await app.close();
});

test('unknown key returns invalid_api_key', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/account', { key: 'hl_live_nope' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'invalid_api_key');
  await app.close();
});

test('account returns the id and default version', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/account');
  assert.equal(response.status, 200);
  assert.match(response.body.id, /^acct_/);
  assert.equal(response.body.api_version, '2026-04-01');
  await app.close();
});

test('a supported version header is accepted', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/account', {
    headers: { 'hookline-version': '2026-03-01' },
  });
  assert.equal(response.status, 200);
  await app.close();
});

test('an unsupported version header is rejected', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/account', {
    headers: { 'hookline-version': '1999-01-01' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_version');
  await app.close();
});

test('unknown routes return the not_found error shape', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/nothing');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
  await app.close();
});

test('every response carries rate limit headers and a request id', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/account');
  assert.match(response.headers['x-request-id'], /^req_/);
  assert.ok(response.headers['x-ratelimit-limit']);
  assert.ok(response.headers['x-ratelimit-remaining']);
  assert.ok(response.headers['x-ratelimit-reset']);
  await app.close();
});

test('a malformed body returns malformed_request', async () => {
  const { app } = await makeApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v2/events',
    headers: { authorization: `Bearer ${TEST_KEY}`, 'content-type': 'application/json' },
    payload: '{"type":',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'malformed_request');
  await app.close();
});

test('test and live keys both reach the account', async () => {
  const { app } = await makeApp();
  const testKey = await call(app, 'GET', '/v2/account', { key: TEST_KEY });
  const liveKey = await call(app, 'GET', '/v2/account', { key: LIVE_KEY });
  assert.equal(testKey.status, 200);
  assert.equal(liveKey.status, 200);
  assert.equal(testKey.body.id, liveKey.body.id);
  await app.close();
});
