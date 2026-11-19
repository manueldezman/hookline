import { newId, sha256 } from './ids.js';
import { isoSeconds } from './time.js';
import { matchesSubscription } from './events/catalog.js';

export function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    created: row.created,
    status: row.status,
    data: JSON.parse(row.data),
  };
}

export function mapEndpoint(row, { withSecret = false } = {}) {
  if (!row) return null;
  const endpoint = {
    id: row.id,
    url: row.url,
    event_types: JSON.parse(row.event_types),
    enabled: row.enabled === 1,
    created: row.created,
  };
  if (row.description !== null && row.description !== undefined) {
    endpoint.description = row.description;
  }
  if (withSecret) endpoint.secret = row.secret;
  return endpoint;
}

export function mapDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    endpoint_id: row.endpoint_id,
    status: row.status,
    attempt: row.attempt,
    response_status: row.response_status ?? null,
    error: row.error ?? null,
    created: row.created,
    next_retry: row.next_retry_ms === null ? null : isoSeconds(row.next_retry_ms),
  };
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  ensureAccount({ plan, apiVersion, testKey, liveKey, nowMs }) {
    let row = this.db.prepare('SELECT * FROM accounts LIMIT 1').get();
    const createdKeys = [];

    if (!row) {
      const id = newId('acct');
      this.db
        .prepare('INSERT INTO accounts (id, plan, api_version, created) VALUES (?, ?, ?, ?)')
        .run(id, plan, apiVersion, isoSeconds(nowMs));
      row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    } else if (row.plan !== plan) {
      this.db.prepare('UPDATE accounts SET plan = ? WHERE id = ?').run(plan, row.id);
      row = { ...row, plan };
    }

    for (const [mode, key] of [['test', testKey], ['live', liveKey]]) {
      const keyHash = sha256(key);
      const existing = this.db
        .prepare('SELECT id FROM api_keys WHERE key_hash = ?')
        .get(keyHash);
      if (!existing) {
        this.db
          .prepare(
            'INSERT INTO api_keys (id, account_id, key_hash, mode, created) VALUES (?, ?, ?, ?, ?)',
          )
          .run(newId('key'), row.id, keyHash, mode, isoSeconds(nowMs));
        createdKeys.push({ mode, key });
      }
    }

    return {
      account: { id: row.id, plan: row.plan, api_version: row.api_version },
      createdKeys,
    };
  }

  findKeyByHash(keyHash) {
    const row = this.db
      .prepare(
        `SELECT k.mode, a.id AS account_id, a.plan, a.api_version
         FROM api_keys k JOIN accounts a ON a.id = k.account_id
         WHERE k.key_hash = ?`,
      )
      .get(keyHash);
    if (!row) return null;
    return {
      mode: row.mode,
      account: { id: row.account_id, plan: row.plan, api_version: row.api_version },
    };
  }

  getAccount(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  insertEvent({
    id,
    accountId,
    type,
    data,
    envelope,
    status,
    idempotencyKey,
    idempotencyHash,
    created,
    createdMs,
  }) {
    this.db
      .prepare(
        `INSERT INTO events
         (id, account_id, type, data, envelope, status, idempotency_key, idempotency_hash, created, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        accountId,
        type,
        JSON.stringify(data),
        envelope,
        status,
        idempotencyKey ?? null,
        idempotencyHash ?? null,
        created,
        createdMs,
      );
    return this.getEventRow(id);
  }

  getEventRow(id) {
    return this.db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  }

  getEvent(id, accountId) {
    return this.db
      .prepare('SELECT * FROM events WHERE id = ? AND account_id = ?')
      .get(id, accountId);
  }

  findEventByIdempotencyKey(accountId, key) {
    return this.db
      .prepare('SELECT * FROM events WHERE account_id = ? AND idempotency_key = ?')
      .get(accountId, key);
  }

  setEventStatus(eventId, status) {
    this.db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, eventId);
  }

  deliveryStatusCounts(eventId) {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM deliveries WHERE event_id = ? GROUP BY status')
      .all(eventId);
    const counts = { pending: 0, succeeded: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  insertEndpoint({
    id,
    accountId,
    url,
    eventTypes,
    description,
    enabled,
    secret,
    created,
    createdMs,
  }) {
    this.db
      .prepare(
        `INSERT INTO endpoints
         (id, account_id, url, event_types, description, enabled, secret, created, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        accountId,
        url,
        JSON.stringify(eventTypes),
        description ?? null,
        enabled ? 1 : 0,
        secret,
        created,
        createdMs,
      );
    return this.getEndpoint(id, accountId);
  }

  getEndpoint(id, accountId) {
    return this.db
      .prepare('SELECT * FROM endpoints WHERE id = ? AND account_id = ?')
      .get(id, accountId);
  }

  getEndpointById(id) {
    return this.db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id);
  }

  listEndpoints(accountId, limit, afterSeq) {
    if (afterSeq === null) {
      return this.db
        .prepare('SELECT * FROM endpoints WHERE account_id = ? ORDER BY seq DESC LIMIT ?')
        .all(accountId, limit);
    }
    return this.db
      .prepare(
        'SELECT * FROM endpoints WHERE account_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
      )
      .all(accountId, afterSeq, limit);
  }

  matchingEndpoints(accountId, type) {
    return this.db
      .prepare('SELECT * FROM endpoints WHERE account_id = ? AND enabled = 1 ORDER BY seq ASC')
      .all(accountId)
      .filter((row) => matchesSubscription(JSON.parse(row.event_types), type));
  }

  updateEndpoint(id, accountId, fields) {
    const sets = [];
    const values = [];
    if (fields.url !== undefined) {
      sets.push('url = ?');
      values.push(fields.url);
    }
    if (fields.eventTypes !== undefined) {
      sets.push('event_types = ?');
      values.push(JSON.stringify(fields.eventTypes));
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      values.push(fields.description);
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(fields.enabled ? 1 : 0);
    }
    if (sets.length === 0) return this.getEndpoint(id, accountId);
    values.push(id, accountId);
    this.db
      .prepare(`UPDATE endpoints SET ${sets.join(', ')} WHERE id = ? AND account_id = ?`)
      .run(...values);
    return this.getEndpoint(id, accountId);
  }

  deleteEndpoint(id, accountId) {
    const row = this.getEndpoint(id, accountId);
    if (!row) return null;
    const affected = this.db
      .prepare(
        "SELECT DISTINCT event_id FROM deliveries WHERE endpoint_id = ? AND account_id = ? AND status = 'pending'",
      )
      .all(id, accountId);
    this.db
      .prepare(
        "UPDATE deliveries SET status = 'failed', next_retry_ms = NULL WHERE endpoint_id = ? AND account_id = ? AND status = 'pending'",
      )
      .run(id, accountId);
    this.db.prepare('DELETE FROM endpoints WHERE id = ? AND account_id = ?').run(id, accountId);
    return affected.map((item) => item.event_id);
  }

  markEndpointFailure(endpointId, nowMs) {
    this.db
      .prepare(
        'UPDATE endpoints SET failing_since_ms = COALESCE(failing_since_ms, ?) WHERE id = ?',
      )
      .run(nowMs, endpointId);
  }

  resetEndpointFailures(endpointId) {
    this.db
      .prepare('UPDATE endpoints SET failing_since_ms = NULL WHERE id = ?')
      .run(endpointId);
  }

  disableEndpoint(endpointId) {
    this.db
      .prepare('UPDATE endpoints SET enabled = 0, failing_since_ms = NULL WHERE id = ?')
      .run(endpointId);
  }

  failPendingForEndpoint(endpointId, accountId) {
    const affected = this.db
      .prepare(
        "SELECT DISTINCT event_id FROM deliveries WHERE endpoint_id = ? AND account_id = ? AND status = 'pending'",
      )
      .all(endpointId, accountId);
    this.db
      .prepare(
        "UPDATE deliveries SET status = 'failed', next_retry_ms = NULL WHERE endpoint_id = ? AND account_id = ? AND status = 'pending'",
      )
      .run(endpointId, accountId);
    return affected.map((item) => item.event_id);
  }

  insertDelivery({
    id,
    accountId,
    eventId,
    endpointId,
    status,
    attempt,
    created,
    createdMs,
    nextRetryMs,
  }) {
    this.db
      .prepare(
        `INSERT INTO deliveries
         (id, account_id, event_id, endpoint_id, status, attempt, response_status, error, created, created_ms, next_retry_ms)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(id, accountId, eventId, endpointId, status, attempt, created, createdMs, nextRetryMs);
    return this.getDeliveryRow(id);
  }

  getDeliveryRow(id) {
    return this.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
  }

  getDelivery(id, accountId) {
    return this.db
      .prepare('SELECT * FROM deliveries WHERE id = ? AND account_id = ?')
      .get(id, accountId);
  }

  listDeliveries(accountId, { limit, afterSeq, endpointId, eventType, status, fromMs, toMs }) {
    const where = ['d.account_id = ?'];
    const params = [accountId];

    if (afterSeq !== null) {
      where.push('d.seq < ?');
      params.push(afterSeq);
    }
    if (endpointId) {
      where.push('d.endpoint_id = ?');
      params.push(endpointId);
    }
    if (status) {
      where.push('d.status = ?');
      params.push(status);
    }
    if (fromMs !== null) {
      where.push('d.created_ms >= ?');
      params.push(fromMs);
    }
    if (toMs !== null) {
      where.push('d.created_ms <= ?');
      params.push(toMs);
    }
    if (eventType) {
      where.push('e.type = ?');
      params.push(eventType);
    }

    params.push(limit);
    return this.db
      .prepare(
        `SELECT d.* FROM deliveries d
         JOIN events e ON e.id = d.event_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.seq DESC LIMIT ?`,
      )
      .all(...params);
  }

  dueDeliveries(nowMs, limit) {
    return this.db
      .prepare(
        "SELECT * FROM deliveries WHERE status = 'pending' AND next_retry_ms IS NOT NULL AND next_retry_ms <= ? ORDER BY next_retry_ms ASC, seq ASC LIMIT ?",
      )
      .all(nowMs, limit);
  }

  updateDeliveryAfterAttempt({
    id,
    status,
    attempt,
    responseStatus,
    error,
    created,
    createdMs,
    nextRetryMs,
  }) {
    this.db
      .prepare(
        `UPDATE deliveries
         SET status = ?, attempt = ?, response_status = ?, error = ?, created = ?, created_ms = ?, next_retry_ms = ?
         WHERE id = ?`,
      )
      .run(
        status,
        attempt,
        responseStatus ?? null,
        error ?? null,
        created,
        createdMs,
        nextRetryMs ?? null,
        id,
      );
  }

  replayCandidates(accountId, { endpointId, fromMs, toMs, status }) {
    const where = [
      'd.account_id = ?',
      'd.endpoint_id = ?',
      'd.created_ms >= ?',
    ];
    const params = [accountId, endpointId, fromMs];
    if (toMs !== null) {
      where.push('d.created_ms <= ?');
      params.push(toMs);
    }
    if (status) {
      where.push('d.status = ?');
      params.push(status);
    }
    return this.db
      .prepare(
        `SELECT DISTINCT d.event_id FROM deliveries d
         WHERE ${where.join(' AND ')}
         ORDER BY d.event_id`,
      )
      .all(...params)
      .map((row) => row.event_id);
  }

  purgeDeliveriesOlderThan(cutoffMs) {
    return this.db.prepare('DELETE FROM deliveries WHERE created_ms < ?').run(cutoffMs).changes;
  }

  insertTestEvent(accountId, eventId, nowMs) {    this.db
      .prepare('INSERT INTO test_events (account_id, event_id, created_ms) VALUES (?, ?, ?)')
      .run(accountId, eventId, nowMs);
  }

  listTestEvents(accountId, afterSeq, limit) {
    return this.db
      .prepare(
        `SELECT t.seq, e.envelope, e.status
         FROM test_events t JOIN events e ON e.id = t.event_id
         WHERE t.account_id = ? AND t.seq > ?
         ORDER BY t.seq ASC LIMIT ?`,
      )
      .all(accountId, afterSeq, limit);
  }
}
