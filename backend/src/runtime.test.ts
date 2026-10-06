import assert from "node:assert/strict";
import test from "node:test";
import { resolveTransport } from "./runtime.js";

test("uses stdio when no HTTP port is configured", () => {
  assert.equal(resolveTransport(undefined, undefined), "stdio");
});

test("preserves local MCP plus HTTP behavior when PORT is configured", () => {
  assert.equal(resolveTransport(undefined, 4020), "both");
});

test("allows an HTTP-only deployment and requires its port", () => {
  assert.equal(resolveTransport("http", 8080), "http");
  assert.throws(() => resolveTransport("http", undefined), /PORT is required/);
});

test("rejects unknown transports", () => {
  assert.throws(() => resolveTransport("socket", 4020), /SETAREH_TRANSPORT/);
});
