import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the agent payment CLI redacts its wallet secret when a request fails", () => {
  const secret = "S_TESTNET_SECRET_MUST_NOT_APPEAR_IN_OUTPUT";
  const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/demo-agent.ts", "quote-for-redaction-test"], {
    cwd: backendDirectory,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, AGENT_STELLAR_PRIVATE_KEY: secret, SETAREH_API_URL: "http://127.0.0.1:1" },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
});
