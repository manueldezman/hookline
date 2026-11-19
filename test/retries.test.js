import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, createEndpoint, createEvent, START } from './helpers.js';

test('six failed attempts end the delivery as failed', async () => {
  const { app, clock } = await makeApp({
    sender: async () => ({ status: 500, error: null }),
  });
  await createEndpoint(app);
  const event = await createEvent(app);
  const id = (await call(app, 'GET', '/v2/deliveries')).body.data[0].id;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await app.worker.runDue();
    const delivery = (await call(app, 'GET', `/v2/deliveries/${id}`)).body;
    if (attempt < 6) {
      assert.equal(delivery.attempt, attempt + 1);
      assert.equal(delivery.status, 'pending');
      assert.ok(delivery.next_retry);
      clock.set(Date.parse(delivery.next_retry));
    } else {
      assert.equal(delivery.attempt, 6);
      assert.equal(delivery.status, 'failed');
      assert.equal(delivery.next_retry, null);
    }
  }

  const retrieved = await call(app, 'GET', `/v2/events/${event.body.id}`);
  assert.equal(retrieved.body.status, 'failed');
  await app.close();
});

test('the delivery id stays stable and the attempt header increments', async () => {
  const captured = [];
  const { app, clock } = await makeApp({
    sender: async (request) => {
      captured.push(request);
      return { status: 500, error: null };
    },
  });
  await createEndpoint(app);
  await createEvent(app);
  await app.worker.runDue();
  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  clock.set(Date.parse(delivery.next_retry));
  await app.worker.runDue();

  assert.equal(captured.length, 2);
  assert.equal(captured[0].headers['Hookline-Delivery'], captured[1].headers['Hookline-Delivery']);
  assert.equal(captured[0].headers['Hookline-Attempt'], '1');
  assert.equal(captured[1].headers['Hookline-Attempt'], '2');
  await app.close();
});

test('a success clears a previous failure streak', async () => {
  let succeed = false;
  const { app } = await makeApp({
    sender: async () =>
      succeed ? { status: 200, error: null } : { status: 500, error: null },
  });
  const endpoint = await createEndpoint(app);
  await createEvent(app);
  await app.worker.runDue();

  let row = app.store.getEndpointById(endpoint.body.id);
  assert.ok(row.failing_since_ms);

  succeed = true;
  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  app.clock.set(Date.parse(delivery.next_retry));
  await app.worker.runDue();

  row = app.store.getEndpointById(endpoint.body.id);
  assert.equal(row.failing_since_ms, null);
  await app.close();
});

test('an endpoint that fails for seven days is disabled', async () => {
  const { app } = await makeApp({
    sender: async () => ({ status: 500, error: null }),
  });
  const endpoint = await createEndpoint(app);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  app.store.db
    .prepare('UPDATE endpoints SET failing_since_ms = ? WHERE id = ?')
    .run(START - sevenDays, endpoint.body.id);

  const event = await createEvent(app);
  await app.worker.runDue();

  const row = app.store.getEndpointById(endpoint.body.id);
  assert.equal(row.enabled, 0);

  const disabledEvents = app.store.db
    .prepare("SELECT * FROM events WHERE type = 'endpoint.disabled'")
    .all();
  assert.equal(disabledEvents.length, 1);
  assert.equal(JSON.parse(disabledEvents[0].data).endpointId, endpoint.body.id);

  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];
  assert.equal(delivery.status, 'failed');

  const retrieved = await call(app, 'GET', `/v2/events/${event.body.id}`);
  assert.equal(retrieved.body.status, 'failed');
  await app.close();
});

test('a disabled endpoint receives no new deliveries', async () => {  const { app } = await makeApp();
  const endpoint = await createEndpoint(app);
  await call(app, 'PATCH', `/v2/endpoints/${endpoint.body.id}`, {
    key: 'hl_live_test',
    payload: { enabled: false },
  });
  await createEvent(app);
  const deliveries = await call(app, 'GET', '/v2/deliveries');
  assert.equal(deliveries.body.data.length, 0);
  await app.close();
});

test('deliveries older than thirty days are removed', async () => {
  const { app } = await makeApp();
  await createEndpoint(app);
  await createEvent(app);
  const delivery = (await call(app, 'GET', '/v2/deliveries')).body.data[0];

  app.store.db
    .prepare('UPDATE deliveries SET created_ms = ? WHERE id = ?')
    .run(START - 31 * 24 * 60 * 60 * 1000, delivery.id);

  await app.worker.runDue();

  const after = await call(app, 'GET', '/v2/deliveries');
  assert.equal(after.body.data.length, 0);
  await app.close();
});
