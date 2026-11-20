import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, createEndpoint, createEvent, LIVE_KEY, START } from './helpers.js';
import { verifySignatureHeader } from '../src/delivery/signature.js';

test('a successful delivery marks the delivery and the event', async () => {
  const { app } = await makeApp();
  const endpoint = await createEndpoint(app);
  const event = await createEvent(app);

  const pending = await call(app, 'GET', '/v2/deliveries');
  const delivery = pending.body.data[0];
  assert.equal(delivery.status, 'pending');
  assert.equal(delivery.attempt, 1);

  await app.worker.runDue();

  const after = await call(app, 'GET', `/v2/deliveries/${delivery.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.status, 'succeeded');
  assert.equal(after.body.response_status, 200);
  assert.equal(after.body.next_retry, null);
  assert.equal('request_body' in after.body, false);

  const retrieved = await call(app, 'GET', `/v2/events/${event.body.id}`);
  assert.equal(retrieved.body.status, 'delivered');
  assert.ok(endpoint.body.id);
  await app.close();
});

test('the delivery request carries the documented headers and a valid signature', async () => {
  let captured = null;
  const { app } = await makeApp({
    sender: async (request) => {
      captured = request;
      return { status: 200, error: null };
    },
  });
  const endpoint = await createEndpoint(app);
  const event = await createEvent(app);
  await app.worker.runDue();

  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  assert.ok(captured);
  assert.equal(captured.headers['Hookline-Event'], 'invoice.paid');
  assert.equal(captured.headers['Hookline-Delivery'], delivery.id);
  assert.equal(captured.headers['Hookline-Attempt'], '1');
  assert.equal(captured.headers['content-type'], 'application/json');
  assert.equal(captured.body, JSON.stringify(JSON.parse(captured.body)));

  const nowSeconds = Math.floor(START / 1000);
  assert.equal(
    verifySignatureHeader(
      captured.headers['Hookline-Signature'],
      captured.body,
      [endpoint.body.secret],
      nowSeconds,
    ),
    true,
  );
  assert.equal(
    verifySignatureHeader(
      captured.headers['Hookline-Signature'],
      `${captured.body} `,
      [endpoint.body.secret],
      nowSeconds,
    ),
    false,
  );
  assert.equal(event.status, 202);
  await app.close();
});

test('a 500 schedules the next attempt one minute later', async () => {
  const { app, clock } = await makeApp({
    sender: async () => ({ status: 500, error: null }),
  });
  await createEndpoint(app);
  const event = await createEvent(app);
  const original = (await call(app, 'GET', '/v2/deliveries')).body.data[0];

  await app.worker.runDue();

  const after = await call(app, 'GET', `/v2/deliveries/${original.id}`);
  assert.equal(after.body.status, 'pending');
  assert.equal(after.body.attempt, 2);
  assert.equal(after.body.response_status, 500);
  assert.equal(Date.parse(after.body.next_retry), START + 60_000);

  clock.advance(60_000);
  await app.worker.runDue();

  const third = await call(app, 'GET', `/v2/deliveries/${original.id}`);
  assert.equal(third.body.attempt, 3);
  assert.equal(Date.parse(third.body.next_retry), START + 60_000 + 600_000);
  assert.equal(third.body.id, original.id);

  const retrieved = await call(app, 'GET', `/v2/events/${event.body.id}`);
  assert.equal(retrieved.body.status, 'queued');
  await app.close();
});

test('a redirect counts as a failure', async () => {
  const { app } = await makeApp({
    sender: async () => ({ status: 301, error: null }),
  });
  await createEndpoint(app);
  await createEvent(app);
  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  await app.worker.runDue();
  const after = await call(app, 'GET', `/v2/deliveries/${delivery.id}`);
  assert.equal(after.body.status, 'pending');
  assert.equal(after.body.response_status, 301);
  await app.close();
});

test('a network error is recorded with the documented value', async () => {
  const { app } = await makeApp({
    sender: async () => ({ status: null, error: 'timeout' }),
  });
  await createEndpoint(app);
  await createEvent(app);
  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  await app.worker.runDue();
  const after = await call(app, 'GET', `/v2/deliveries/${delivery.id}`);
  assert.equal(after.body.status, 'pending');
  assert.equal(after.body.response_status, null);
  assert.equal(after.body.error, 'timeout');
  await app.close();
});

test('replay creates a new delivery for the same event', async () => {
  const { app } = await makeApp();
  await createEndpoint(app);
  const event = await createEvent(app);
  const original = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  await app.worker.runDue();

  const replay = await call(app, 'POST', `/v2/deliveries/${original.id}/replay`, {
    key: LIVE_KEY,
  });
  assert.equal(replay.status, 202);
  assert.notEqual(replay.body.id, original.id);
  assert.equal(replay.body.event_id, event.body.id);
  assert.equal(replay.body.attempt, 1);
  assert.equal(replay.body.status, 'pending');

  const originalAfter = await call(app, 'GET', `/v2/deliveries/${original.id}`);
  assert.equal(originalAfter.body.status, 'succeeded');
  await app.close();
});

test('replaying an unknown delivery returns 404', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'POST', '/v2/deliveries/dlv_missing/replay', {
    key: LIVE_KEY,
  });
  assert.equal(response.status, 404);
  await app.close();
});

test('replay a range queues one delivery per event', async () => {
  const { app } = await makeApp();
  const endpoint = await createEndpoint(app);
  await createEvent(app);
  await createEvent(app);

  const response = await call(app, 'POST', '/v2/deliveries/replay', {
    key: LIVE_KEY,
    payload: {
      endpoint_id: endpoint.body.id,
      created_after: '2026-03-01T00:00:00Z',
    },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.queued, 2);

  const all = await call(app, 'GET', '/v2/deliveries?limit=100');
  assert.equal(all.body.data.length, 4);
  await app.close();
});

test('delivery list filters by endpoint, event type, and status', async () => {
  const { app } = await makeApp();
  const paid = await createEndpoint(app, { event_types: ['invoice.paid'] });
  const failed = await createEndpoint(app, { event_types: ['invoice.failed'] });
  await createEvent(app);

  const byEndpoint = await call(app, 'GET', `/v2/deliveries?endpoint_id=${paid.body.id}`);
  assert.equal(byEndpoint.body.data.length, 1);
  assert.equal(byEndpoint.body.data[0].endpoint_id, paid.body.id);

  const otherEndpoint = await call(app, 'GET', `/v2/deliveries?endpoint_id=${failed.body.id}`);
  assert.equal(otherEndpoint.body.data.length, 0);

  const byType = await call(app, 'GET', '/v2/deliveries?event_type=invoice.paid');
  assert.equal(byType.body.data.length, 1);

  const byStatus = await call(app, 'GET', '/v2/deliveries?status=succeeded');
  assert.equal(byStatus.body.data.length, 0);
  await app.close();
});

test('delivery window filters work on created time', async () => {
  const { app, clock } = await makeApp();
  await createEndpoint(app);
  await createEvent(app);

  const inside = await call(
    app,
    'GET',
    '/v2/deliveries?created_after=2026-03-04T00:00:00Z&created_before=2026-03-05T00:00:00Z',
  );
  assert.equal(inside.body.data.length, 1);

  const outside = await call(
    app,
    'GET',
    '/v2/deliveries?created_after=2026-03-05T00:00:00Z',
  );
  assert.equal(outside.body.data.length, 0);
  assert.ok(clock.now() > 0);
  await app.close();
});

test('a delivery window with created_before before created_after is rejected', async () => {
  const { app } = await makeApp();
  const endpoint = await createEndpoint(app);
  const response = await call(app, 'POST', '/v2/deliveries/replay', {
    key: LIVE_KEY,
    payload: {
      endpoint_id: endpoint.body.id,
      created_after: '2026-03-05T00:00:00Z',
      created_before: '2026-03-01T00:00:00Z',
    },
  });
  assert.equal(response.status, 422);
  await app.close();
});
