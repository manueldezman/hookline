const WINDOW_MS = 60_000;

export class RateLimiter {
  constructor({ clock, planLimits }) {
    this.clock = clock;
    this.planLimits = planLimits;
    this.counters = new Map();
  }

  consume(accountId, plan, kind) {
    const nowMs = this.clock.now();
    const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
    const reset = Math.floor((windowStart + WINDOW_MS) / 1000);
    const key = `${accountId}:${kind}:${windowStart}`;
    const limit = this.planLimits[plan]?.[kind] ?? this.planLimits.free[kind];
    const used = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, used);

    if (this.counters.size > 5000) {
      for (const entry of this.counters.keys()) {
        const start = Number(entry.split(':').pop());
        if (start < windowStart - WINDOW_MS * 2) this.counters.delete(entry);
      }
    }

    return {
      allowed: used <= limit,
      limit,
      remaining: Math.max(0, limit - used),
      reset,
    };
  }
}
