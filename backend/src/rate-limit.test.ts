import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommerceService } from "./commerce.js";
import type { SetarehConfig } from "./config.js";
import { SetarehDatabase } from "./db.js";
import { createHttpApp } from "./http.js";
import { SlidingWindowLimiter, clientKey } from "./rate-limit.js";

test("sliding window admits up to the limit and recovers once hits leave the window", () => {
  const limiter = new SlidingWindowLimiter(2, 1_000);
  assert.ok(limiter.allow("a", 0));
  assert.ok(limiter.allow("a", 100));
  assert.equal(limiter.allow("a", 200), false);
  assert.ok(limiter.allow("b", 200), "keys are independent");
  assert.ok(limiter.allow("a", 1_001), "the first hit expired");
  assert.throws(() => new SlidingWindowLimiter(0, 1_000));
});

test("client key prefers the Fly proxy header over the socket address", () => {
  assert.equal(clientKey({ get: (name) => (name === "fly-client-ip" ? "203.0.113.7" : undefined), ip: "172.16.0.1" }), "203.0.113.7");
  assert.equal(clientKey({ get: () => undefined, ip: "172.16.0.1" }), "172.16.0.1");
});

test("quote creation is throttled per client before the request body is processed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "setareh-ratelimit-"));
  const database = new SetarehDatabase(join(directory, "setareh.db"));
  const config: SetarehConfig = { databasePath: join(directory, "setareh.db"), merchantId: "micohstore", merchantName: "Micohstore", stellarNetwork: "stellar:testnet", stellarAsset: "USDC", stellarMerchantAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", facilitatorUrl: "http://127.0.0.1:9", maxQuoteUsdc: 30, quoteTtlMinutes: 10, usdcPerClp: 0.001 };
  const service = new CommerceService(config, database, { domain: "micohstore.myshopify.com" } as any);
  const server = createHttpApp(service, { quoteRateLimits: { perClientPerHour: 2, globalPerHour: 3 } }).listen(0, "127.0.0.1");
  const base = await new Promise<string>((resolve) => server.on("listening", () => { const address = server.address(); assert.ok(address && typeof address !== "string"); resolve(`http://127.0.0.1:${address.port}`); }));
  const post = (ip: string) => fetch(`${base}/v1/quotes`, { method: "POST", headers: { "Content-Type": "application/json", "Fly-Client-IP": ip }, body: "{}" });
  try {
    assert.equal((await post("198.51.100.1")).status, 400, "invalid bodies are rejected but still counted");
    assert.equal((await post("198.51.100.1")).status, 400);
    const limited = await post("198.51.100.1");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "3600");
    assert.equal((await post("198.51.100.2")).status, 400, "another client still has quota");
    assert.equal((await post("198.51.100.3")).status, 429, "the global cap protects the store");
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
