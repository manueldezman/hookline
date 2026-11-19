import { forbidden, invalidField } from '../errors.js';

export default async function internalRoutes(app) {
  app.get('/internal/test-events', async (request, reply) => {
    if (request.keyMode !== 'test') {
      throw forbidden('Test events require a test key.');
    }

    const after = Number(request.query.after ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      throw invalidField('after must be a non-negative integer.');
    }

    const rows = app.store.listTestEvents(request.account.id, after, 100);
    reply.send({
      data: rows.map((row) => ({
        seq: row.seq,
        event: JSON.parse(row.envelope),
      })),
      next_cursor: rows.length > 0 ? rows[rows.length - 1].seq : after,
    });
  });
}
