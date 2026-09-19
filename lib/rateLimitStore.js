'use strict';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50000;

class RateLimitStore {
  constructor(
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    this.ttlMs = ttlMs;
    this.maxEntries =
      Number.isInteger(maxEntries) && maxEntries > 0
        ? maxEntries
        : DEFAULT_MAX_ENTRIES;
    this.entries = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  cleanup(now = Date.now()) {
    for (const [key, value] of this.entries.entries()) {
      if (value.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  reset(key) {
    return this.entries.delete(key);
  }

  enforceCapacity() {
    while (this.entries.size >= this.maxEntries) {
      const oldestKey =
        this.entries.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.entries.delete(oldestKey);
    }
  }

  hit(key, windowMs, maxHits) {
    const now = Date.now();
    let existing = this.entries.get(key);

    if (existing && existing.expiresAt <= now) {
      this.entries.delete(key);
      existing = null;
    }

    if (!existing) {
      // Evita un recorrido O(n) en cada request. La limpieza global ya se
      // ejecuta periódicamente; solo forzamos una antes de desalojar por capacidad.
      if (this.entries.size >= this.maxEntries) {
        this.cleanup(now);
      }

      this.enforceCapacity();

      this.entries.set(key, {
        hits: 1,
        expiresAt: now + windowMs
      });
      return { allowed: true, remaining: maxHits - 1 };
    }

    if (existing.hits >= maxHits) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: existing.expiresAt - now
      };
    }

    existing.hits += 1;
    this.entries.set(key, existing);

    return {
      allowed: true,
      remaining: maxHits - existing.hits
    };
  }
}

module.exports = {
  RateLimitStore,
  DEFAULT_MAX_ENTRIES
};
