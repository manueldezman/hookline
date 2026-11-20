import { ApiError } from '../errors.js';
import { newId, sha256 } from '../ids.js';
import { isoSeconds } from '../time.js';
import { mapEvent } from '../store.js';

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createEvent({
  store,
  clock,
  config,
  accountId,
  keyMode,
  type,
  payload,
  idempotencyKey,
}) {
  const nowMs = clock.now();
  const idempotencyHash = idempotencyKey
    ? sha256(stableStringify({ type, payload }))
    : null;

  if (idempotencyKey) {
    const existing = store.findEventByIdempotencyKey(accountId, idempotencyKey);
    if (existing) {
      if (existing.idempotency_hash !== idempotencyHash) {
        throw new ApiError(
          409,
          'duplicate_idempotency_key',
          'This idempotency key was used with a different body.',
        );
      }
      return { event: mapEvent(existing), duplicate: true };
    }
  }

  const id = newId('evt');
  const created = isoSeconds(nowMs);
  const envelope = JSON.stringify({ id, type, created, data: payload });

  store.db.exec('BEGIN');
  let eventRow;
  try {
    eventRow = store.insertEvent({
      id,
      accountId,
      type,
      data: payload,
      envelope,
      status: 'queued',
      idempotencyKey: idempotencyKey ?? null,
      idempotencyHash,
      created,
      createdMs: nowMs,
    });

    if (keyMode === 'test') {
      store.insertTestEvent(accountId, id, nowMs);
    } else {
      const endpoints = store.matchingEndpoints(accountId, type);
      for (const endpoint of endpoints) {
        store.insertDelivery({
          id: newId('dlv'),
          accountId,
          eventId: id,
          endpointId: endpoint.id,
          status: 'pending',
          attempt: 1,
          created,
          createdMs: nowMs,
          nextRetryMs: nowMs,
        });
      }
    }
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }

  return { event: mapEvent(eventRow), duplicate: false };
}

export { stableStringify };
