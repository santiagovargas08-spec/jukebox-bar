'use strict';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

class RateLimitStore {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
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

  hit(key, windowMs, maxHits) {
    const now = Date.now();
    this.cleanup(now);

    const existing = this.entries.get(key);

    if (!existing || existing.expiresAt <= now) {
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
  RateLimitStore
};
