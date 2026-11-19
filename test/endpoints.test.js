import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, createEndpoint, createEvent, LIVE_KEY } from './helpers.js';
import { ApiError } from '../src/errors.js';

test('creating an endpoint returns the secret once', async () => {
  const { app } = await makeApp();
  const response = await createEndpoint(app, { description: 'Billing service' });

  assert.equal(response.status, 201);
  assert.match(response.body.id, /^ep_[0-9a-f]{12}$/);
  assert.match(response.body.secret, /^whsec_[0-9a-f]{32}$/);
  assert.equal(response.body.description, 'Billing service');
  assert.equal(response.body.enabled, true);

  const list = await call(app, 'GET', '/v2/endpoints');
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].secret, undefined);
  await app.close();
});

test('enabled defaults to true and can be set to false', async () => {
  const { app } = await makeApp();
  const disabled = await createEndpoint(app, { enabled: false });
  assert.equal(disabled.body.enabled, false);
  await app.close();
});

test('an unknown event type in the subscription is rejected', async () => {
  const { app } = await makeApp();
  const response = await createEndpoint(app, { event_types: ['invoice.paid', 'nope'] });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'validation_failed');
  await app.close();
});

test('a wildcard subscription is accepted', async () => {
  const { app } = await makeApp();
  const response = await createEndpoint(app, { event_types: ['invoice.*'] });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.event_types, ['invoice.*']);
  await app.close();
});

test('a URL that fails verification is rejected', async () => {
  const { app } = await makeApp({
    verifier: async () => {
      throw new ApiError(422, 'endpoint_unreachable', 'The URL must use HTTPS.');
    },
  });
  const response = await createEndpoint(app);
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'endpoint_unreachable');
  await app.close();
});

test('updating an endpoint replaces event_types and leaves other fields', async () => {
  const { app } = await makeApp();
  const created = await createEndpoint(app, {
    description: 'Keep me',
    event_types: ['invoice.paid'],
  });

  const response = await call(app, 'PATCH', `/v2/endpoints/${created.body.id}`, {
    key: LIVE_KEY,
    payload: { event_types: ['invoice.failed'] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event_types, ['invoice.failed']);
  assert.equal(response.body.description, 'Keep me');
  await app.close();
});

test('an empty update is rejected', async () => {
  const { app } = await makeApp();
  const created = await createEndpoint(app);
  const response = await call(app, 'PATCH', `/v2/endpoints/${created.body.id}`, {
    key: LIVE_KEY,
    payload: {},
  });
  assert.equal(response.status, 400);
  await app.close();
});

test('updating an unknown endpoint returns 404', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'PATCH', '/v2/endpoints/ep_missing', {
    key: LIVE_KEY,
    payload: { enabled: false },
  });
  assert.equal(response.status, 404);
  await app.close();
});

test('deleting an endpoint cancels pending deliveries', async () => {
  const { app } = await makeApp();
  const endpoint = await createEndpoint(app);
  const event = await createEvent(app);

  const deleted = await call(app, 'DELETE', `/v2/endpoints/${endpoint.body.id}`, {
    key: LIVE_KEY,
  });
  assert.equal(deleted.status, 204);

  const deliveries = await call(app, 'GET', '/v2/deliveries');
  assert.equal(deliveries.body.data.length, 1);
  assert.equal(deliveries.body.data[0].status, 'failed');

  const retrieved = await call(app, 'GET', `/v2/events/${event.body.id}`);
  assert.equal(retrieved.body.status, 'failed');
  await app.close();
});

test('deleting an unknown endpoint returns 404', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'DELETE', '/v2/endpoints/ep_missing', { key: LIVE_KEY });
  assert.equal(response.status, 404);
  await app.close();
});

test('endpoints page newest first with a stable cursor', async () => {
  const { app } = await makeApp();
  const first = await createEndpoint(app, { description: 'first' });
  const second = await createEndpoint(app, { description: 'second' });
  const third = await createEndpoint(app, { description: 'third' });

  const page1 = await call(app, 'GET', '/v2/endpoints?limit=2');
  assert.equal(page1.body.data.length, 2);
  assert.equal(page1.body.has_more, true);
  assert.equal(page1.body.data[0].id, third.body.id);
  assert.equal(page1.body.data[1].id, second.body.id);
  assert.ok(page1.body.next_cursor);

  const page2 = await call(
    app,
    'GET',
    `/v2/endpoints?limit=2&starting_after=${encodeURIComponent(page1.body.next_cursor)}`,
  );
  assert.equal(page2.body.data.length, 1);
  assert.equal(page2.body.data[0].id, first.body.id);
  assert.equal(page2.body.has_more, false);
  assert.equal(page2.body.next_cursor, null);
  await app.close();
});

test('an invalid limit is rejected', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/endpoints?limit=101');
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'validation_failed');
  await app.close();
});

test('an invalid cursor is rejected', async () => {
  const { app } = await makeApp();
  const response = await call(app, 'GET', '/v2/endpoints?starting_after=nope');
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'validation_failed');
  await app.close();
});
