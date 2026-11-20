import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, createEvent, TEST_KEY, LIVE_KEY } from './helpers.js';

test('creating an event returns the documented shape', async () => {
  const { app } = await makeApp();
  const response = await createEvent(app);

  assert.equal(response.status, 202);
  assert.match(response.body.id, /^evt_[0-9a-f]{12}$/);
  assert.equal(response.body.type, 'invoice.paid');
  assert.equal(response.body.status, 'queued');
  assert.deepEqual(response.body.data, {
    invoiceId: 'inv_1042',
    amount: 4900,
    currency: 'USD',
  });
  assert.match(response.body.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  await app.close();
});

test('a missing field returns 400', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'POST', '/v2/events', {
    key: LIVE_KEY,
    payload: { type: 'invoice.paid' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'malformed_request');
  await app.close();
});

test('an unknown event type returns unknown_event_type', async () => {
  const { app } = await makeApp();
  const response = await createEvent(app, { type: 'invoice.paid.extra' });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'unknown_event_type');
  await app.close();
});

test('a payload field with the wrong type returns validation_failed', async () => {
  const { app } = await makeApp();
  const response = await createEvent(app, {
    payload: { invoiceId: 'inv_1', amount: '4900' },
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'validation_failed');
  assert.match(response.body.error.message, /payload\.amount/);
  await app.close();
});

test('a non-object payload returns validation_failed', async () => {
  const { app } = await makeApp();
  const response = await createEvent(app, { payload: [1, 2] });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'validation_failed');
  await app.close();
});

test('an idempotency key returns the original event', async () => {
  const { app } = await makeApp();
  const first = await createEvent(app, { idempotency_key: 'idem-1' });
  const second = await createEvent(app, { idempotency_key: 'idem-1' });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(second.body.id, first.body.id);
  await app.close();
});

test('an idempotency key with a different body returns a conflict', async () => {
  const { app } = await makeApp();
  await createEvent(app, { idempotency_key: 'idem-2' });
  const response = await createEvent(app, {
    idempotency_key: 'idem-2',
    payload: { invoiceId: 'inv_other' },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'duplicate_idempotency_key');
  await app.close();
});

test('payload field order does not change the idempotency hash', async () => {
  const { app } = await makeApp();
  const first = await createEvent(app, {
    idempotency_key: 'idem-3',
    payload: { invoiceId: 'inv_1', amount: 10 },
  });
  const second = await createEvent(app, {
    idempotency_key: 'idem-3',
    payload: { amount: 10, invoiceId: 'inv_1' },
  });
  assert.equal(second.body.id, first.body.id);
  await app.close();
});

test('retrieving an event returns its current status', async () => {
  const { app } = await makeApp();
  const created = await createEvent(app);
  const response = await call(app, 'GET', `/v2/events/${created.body.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.id, created.body.id);
  assert.equal(response.body.status, 'queued');
  await app.close();
});

test('retrieving an unknown event returns 404', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/events/evt_missing');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'not_found');
  await app.close();
});

test('a body over 256 KB returns payload_too_large', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'POST', '/v2/events', {
    key: LIVE_KEY,
    payload: {
      type: 'invoice.paid',
      payload: { invoiceId: 'inv_1', note: 'x'.repeat(300 * 1024) },
    },
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'payload_too_large');
  await app.close();
});

test('a test key queues the event for the CLI listener', async () => {
  const { app } = await makeApp();
  const created = await createEvent(app, {});
  assert.equal(created.status, 202);

  const testEvent = await call(app, 'POST', '/v2/events', {
    key: TEST_KEY,
    payload: { type: 'invoice.paid', payload: { invoiceId: 'inv_test' } },
  });
  const queue = await call(app, 'GET', '/internal/test-events?after=0', { key: TEST_KEY });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.data.length, 1);
  assert.equal(queue.body.data[0].event.id, testEvent.body.id);
  await app.close();
});

test('a live key cannot read the test event queue', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/internal/test-events', { key: LIVE_KEY });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'forbidden');
  await app.close();
});
