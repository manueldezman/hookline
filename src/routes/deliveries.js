import { invalidField, notFound } from '../errors.js';
import { newId } from '../ids.js';
import { buildPage, cursorFromQuery, parseLimit } from '../pagination.js';
import { mapDelivery } from '../store.js';
import { isoSeconds } from '../time.js';
import {
  bodyObject,
  optionalEnum,
  optionalTimestamp,
  queryTimestamp,
  requireString,
  requireTimestamp,
} from '../validate.js';

const DELIVERY_STATUSES = ['succeeded', 'failed', 'pending'];

function insertReplay(app, original, nowMs) {
  return app.store.insertDelivery({
    id: newId('dlv'),
    accountId: original.account_id,
    eventId: original.event_id,
    endpointId: original.endpoint_id,
    status: 'pending',
    attempt: 1,
    created: isoSeconds(nowMs),
    createdMs: nowMs,
    nextRetryMs: nowMs,
  });
}

export default async function deliveriesRoutes(app) {
  app.get('/v2/deliveries', async (request, reply) => {
    const query = request.query;
    const limit = parseLimit(query.limit);
    const afterSeq = cursorFromQuery(query);
    const fromMs = queryTimestamp(query, 'created_after');
    const toMs = queryTimestamp(query, 'created_before');
    const status = optionalEnum(query, 'status', DELIVERY_STATUSES);
    const rows = app.store.listDeliveries(request.account.id, {
      limit: limit + 1,
      afterSeq,
      endpointId: query.endpoint_id,
      eventType: query.event_type,
      status,
      fromMs,
      toMs,
    });
    reply.send(buildPage(rows, limit, mapDelivery));
  });

  app.post('/v2/deliveries/replay', async (request, reply) => {
    const body = bodyObject(request.body);
    const endpointId = requireString(body, 'endpoint_id');
    const fromMs = requireTimestamp(body, 'created_after');
    const toMs = optionalTimestamp(body, 'created_before');
    const status = optionalEnum(body, 'status', DELIVERY_STATUSES);

    if (toMs !== null && toMs < fromMs) {
      throw invalidField('created_before must be after created_after.');
    }

    const endpoint = app.store.getEndpoint(endpointId, request.account.id);
    if (!endpoint) throw notFound('The endpoint does not exist.');

    const eventIds = app.store.replayCandidates(request.account.id, {
      endpointId,
      fromMs,
      toMs,
      status,
    });

    const nowMs = app.clock.now();
    app.store.db.exec('BEGIN');
    try {
      for (const eventId of eventIds) {
        insertReplay(
          app,
          {
            account_id: request.account.id,
            event_id: eventId,
            endpoint_id: endpointId,
          },
          nowMs,
        );
      }
      app.store.db.exec('COMMIT');
    } catch (error) {
      app.store.db.exec('ROLLBACK');
      throw error;
    }

    reply.code(202).send({ queued: eventIds.length });
  });

  app.get('/v2/deliveries/:id', async (request, reply) => {
    const row = app.store.getDelivery(request.params.id, request.account.id);
    if (!row) throw notFound();
    reply.send(mapDelivery(row));
  });

  app.post('/v2/deliveries/:id/replay', async (request, reply) => {
    const original = app.store.getDelivery(request.params.id, request.account.id);
    if (!original) throw notFound();
    const endpoint = app.store.getEndpoint(original.endpoint_id, request.account.id);
    if (!endpoint) throw notFound('The endpoint for this delivery no longer exists.');

    const row = insertReplay(app, original, app.clock.now());
    reply.code(202).send(mapDelivery(row));
  });
}
