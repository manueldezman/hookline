import { invalidField, malformed, notFound } from '../errors.js';
import { isKnownSubscription } from '../events/catalog.js';
import { newId, newSecret } from '../ids.js';
import { buildPage, cursorFromQuery, parseLimit } from '../pagination.js';
import { mapEndpoint } from '../store.js';
import { isoSeconds } from '../time.js';
import { refreshEventStatus } from '../delivery/status.js';
import {
  bodyObject,
  optionalBoolean,
  optionalString,
  requireString,
  requireStringArray,
} from '../validate.js';

function assertSubscriptions(patterns) {
  for (const pattern of patterns) {
    if (!isKnownSubscription(pattern)) {
      throw invalidField(`${pattern} is not a known event type or wildcard.`);
    }
  }
}

export default async function endpointsRoutes(app) {
  app.get('/v2/endpoints', async (request, reply) => {
    const limit = parseLimit(request.query.limit);
    const afterSeq = cursorFromQuery(request.query);
    const rows = app.store.listEndpoints(request.account.id, limit + 1, afterSeq);
    reply.send(buildPage(rows, limit, (row) => mapEndpoint(row)));
  });

  app.post('/v2/endpoints', async (request, reply) => {
    const body = bodyObject(request.body);
    const url = requireString(body, 'url');
    const eventTypes = requireStringArray(body, 'event_types');
    assertSubscriptions(eventTypes);

    const description = optionalString(body, 'description');
    const enabled = optionalBoolean(body, 'enabled') ?? true;

    await app.verifyEndpoint(url);

    const nowMs = app.clock.now();
    const row = app.store.insertEndpoint({
      id: newId('ep'),
      accountId: request.account.id,
      url,
      eventTypes,
      description,
      enabled,
      secret: newSecret(),
      created: isoSeconds(nowMs),
      createdMs: nowMs,
    });

    reply.code(201).send(mapEndpoint(row, { withSecret: true }));
  });

  app.patch('/v2/endpoints/:id', async (request, reply) => {
    const existing = app.store.getEndpoint(request.params.id, request.account.id);
    if (!existing) throw notFound();

    const body = bodyObject(request.body);
    const fields = {};

    if (body.url !== undefined) {
      fields.url = requireString(body, 'url');
      await app.verifyEndpoint(fields.url);
    }
    if (body.event_types !== undefined) {
      fields.eventTypes = requireStringArray(body, 'event_types');
      assertSubscriptions(fields.eventTypes);
    }
    if (body.description !== undefined) {
      fields.description = optionalString(body, 'description');
    }
    if (body.enabled !== undefined) {
      fields.enabled = optionalBoolean(body, 'enabled');
    }

    if (Object.keys(fields).length === 0) {
      throw malformed('At least one field is required.');
    }

    const row = app.store.updateEndpoint(existing.id, request.account.id, fields);
    reply.send(mapEndpoint(row));
  });

  app.delete('/v2/endpoints/:id', async (request, reply) => {
    const affected = app.store.deleteEndpoint(request.params.id, request.account.id);
    if (affected === null) throw notFound();
    for (const eventId of affected) refreshEventStatus(app.store, eventId);
    reply.code(204).send();
  });
}
