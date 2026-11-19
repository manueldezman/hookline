import { ApiError, notFound } from '../errors.js';
import { createEvent } from '../events/create.js';
import { isKnownType, validatePayload } from '../events/catalog.js';
import { mapEvent } from '../store.js';
import { bodyObject, optionalString, requireObject, requireString } from '../validate.js';

export default async function eventsRoutes(app) {
  app.post('/v2/events', async (request, reply) => {
    const body = bodyObject(request.body);
    const type = requireString(body, 'type');

    if (!isKnownType(type)) {
      throw new ApiError(
        422,
        'unknown_event_type',
        `The event type ${type} is not in the catalog.`,
      );
    }

    const payload = requireObject(body, 'payload');
    const problems = validatePayload(type, payload);
    if (problems.length > 0) {
      throw new ApiError(422, 'validation_failed', problems[0]);
    }

    const idempotencyKey = optionalString(body, 'idempotency_key');
    const result = createEvent({
      store: app.store,
      clock: app.clock,
      config: app.config,
      accountId: request.account.id,
      keyMode: request.keyMode,
      type,
      payload,
      idempotencyKey,
    });

    reply.code(202).send(result.event);
  });

  app.get('/v2/events/:id', async (request, reply) => {
    const row = app.store.getEvent(request.params.id, request.account.id);
    if (!row) throw notFound();
    reply.send(mapEvent(row));
  });
}
