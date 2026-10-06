#!/usr/bin/env -S node --import tsx

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redisCommand } from "../src/lib/redis";

/** Only touches a unique, expiring test key; never reads or clears application data. */
async function main(): Promise<void> {
  assert.equal(await redisCommand<string>(["PING"]), "PONG");
  console.log("Redis: authenticated connection passed.");

  const key = `aiq:connection-check:${randomUUID()}`;
  const value = randomUUID();
  try {
    assert.equal(await redisCommand<string>(["SET", key, value, "EX", 60, "NX"]), "OK");
    assert.equal(await redisCommand<string | null>(["GET", key]), value);
    const ttl = await redisCommand<number>(["TTL", key]);
    assert.ok(ttl > 0 && ttl <= 60);
    console.log("Redis: write, read and expiry passed.");

    assert.equal(await redisCommand<string | null>(["SET", key, "replacement", "EX", 60, "NX"]), null);
    assert.equal(await redisCommand<string | null>(["GET", key]), value);
    console.log("Redis: atomic duplicate protection passed.");
  } finally {
    await redisCommand<number>(["DEL", key]);
  }
  assert.equal(await redisCommand<string | null>(["GET", key]), null);
  console.log("Redis: test key removed. All connection checks passed.");
}

main().catch((error: unknown) => {
  // Assertions and network errors can include data; print only our transport's safe errors.
  const message = error instanceof Error && /^(Set KV_|KV_REST_API_URL|Upstash Redis|Redis is only)/.test(error.message)
    ? error.message
    : "Connection check failed. Check Redis credentials, connectivity and permissions.";
  console.error(`Redis: ${message}`);
  process.exitCode = 1;
});
