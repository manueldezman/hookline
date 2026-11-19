import { isoSeconds } from '../time.js';
import { signatureHeader } from './signature.js';
import { refreshEventStatus } from './status.js';
import { createEvent } from '../events/create.js';

export class DeliveryWorker {
  constructor({ store, clock, config, sender, logger = null }) {
    this.store = store;
    this.clock = clock;
    this.config = config;
    this.sender = sender;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastCleanupMs = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runDue().catch((error) => this.logger?.error?.(error));
    }, this.config.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runDue() {
    if (this.running) return 0;
    this.running = true;
    try {
      const nowMs = this.clock.now();
      if (
        this.lastCleanupMs === null ||
        nowMs - this.lastCleanupMs >= this.config.cleanupIntervalMs
      ) {
        this.store.purgeDeliveriesOlderThan(nowMs - this.config.retentionMs);
        this.lastCleanupMs = nowMs;
      }

      const due = this.store.dueDeliveries(nowMs, 50);
      for (const delivery of due) {
        try {
          await this.attempt(delivery);
        } catch (error) {
          this.logger?.error?.(error, 'delivery attempt failed');
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  async attempt(delivery) {
    const nowMs = this.clock.now();
    const event = this.store.getEventRow(delivery.event_id);
    const endpoint = this.store.getEndpointById(delivery.endpoint_id);

    if (!event || !endpoint || endpoint.enabled !== 1) {
      this.recordFailure(delivery, {
        nowMs,
        responseStatus: null,
        error: null,
        terminal: true,
      });
      refreshEventStatus(this.store, delivery.event_id);
      return;
    }

    const timestamp = Math.floor(nowMs / 1000);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'Hookline/1.0',
      'Hookline-Event': event.type,
      'Hookline-Delivery': delivery.id,
      'Hookline-Signature': signatureHeader([endpoint.secret], timestamp, event.envelope),
      'Hookline-Attempt': String(delivery.attempt),
    };

    const result = await this.sender({
      url: endpoint.url,
      body: event.envelope,
      headers,
      timeoutMs: this.config.deliveryTimeoutMs,
    });

    if (result.status !== null && result.status >= 200 && result.status < 300) {
      this.store.updateDeliveryAfterAttempt({
        id: delivery.id,
        status: 'succeeded',
        attempt: delivery.attempt,
        responseStatus: result.status,
        error: null,
        created: isoSeconds(nowMs),
        createdMs: nowMs,
        nextRetryMs: null,
      });
      this.store.resetEndpointFailures(endpoint.id);
      refreshEventStatus(this.store, delivery.event_id);
      return;
    }

    this.recordFailure(delivery, {
      nowMs,
      responseStatus: result.status,
      error: result.error,
      terminal: false,
    });
    this.store.markEndpointFailure(endpoint.id, nowMs);

    const fresh = this.store.getEndpointById(endpoint.id);
    if (
      fresh &&
      fresh.failing_since_ms !== null &&
      nowMs - fresh.failing_since_ms >= this.config.disableAfterMs
    ) {
      this.store.disableEndpoint(endpoint.id);
      const affected = this.store.failPendingForEndpoint(endpoint.id, delivery.account_id);
      for (const eventId of new Set([...affected, delivery.event_id])) {
        refreshEventStatus(this.store, eventId);
      }
      this.emitDisabledEvent(endpoint, delivery.account_id);
      return;
    }

    refreshEventStatus(this.store, delivery.event_id);
  }

  recordFailure(delivery, { nowMs, responseStatus, error, terminal }) {
    const final = terminal || delivery.attempt >= this.config.maxAttempts;
    const delayIndex = delivery.attempt - 1;
    const nextRetryMs =
      final || delayIndex >= this.config.retryDelaysSeconds.length
        ? null
        : nowMs + this.config.retryDelaysSeconds[delayIndex] * 1000;

    this.store.updateDeliveryAfterAttempt({
      id: delivery.id,
      status: final ? 'failed' : 'pending',
      attempt: final ? delivery.attempt : delivery.attempt + 1,
      responseStatus,
      error,
      created: isoSeconds(nowMs),
      createdMs: nowMs,
      nextRetryMs,
    });
  }

  emitDisabledEvent(endpoint, accountId) {
    try {
      createEvent({
        store: this.store,
        clock: this.clock,
        config: this.config,
        accountId,
        keyMode: 'live',
        type: 'endpoint.disabled',
        payload: {
          endpointId: endpoint.id,
          reason: 'Delivery to the endpoint failed for seven days.',
        },
      });
    } catch (error) {
      this.logger?.error?.(error, 'could not emit endpoint.disabled');
    }
  }
}
