// Runs `npm audit --omit=dev` and fails on every advisory except the accepted ones below.
// Each exception is pinned to one advisory, one package path and an expiry date, so it
// cannot silently cover a new vulnerability or outlive its review.
import { execFileSync } from "node:child_process";

const ACCEPTED = [
  {
    advisory: "GHSA-mrhx-c7xc-m3w5",
    package: "zod",
    // Only the zod 3 copy that @x402 pins; our own zod must stay patched.
    paths: ["node_modules/@x402/core/node_modules/zod", "node_modules/@x402/extensions/node_modules/zod"],
    expires: "2026-11-30",
    reason: "No patched zod 3 exists and @x402/core@2.28.0 (latest) requires zod ^3.24.2; it cannot run on zod 4. "
      + "x402 only validates the PAYMENT-SIGNATURE header (bounded by Node's 16 KB header limit) and responses from the configured facilitator.",
  },
];

let report;
try {
  report = JSON.parse(execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" }));
} catch (error) {
  // npm audit exits non-zero when it finds advisories; its JSON report is still on stdout.
  if (!error.stdout) throw error;
  report = JSON.parse(error.stdout);
}

const today = new Date().toISOString().slice(0, 10);
const rejected = [];
const accepted = new Set();
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    // String entries point at another vulnerable package, which is checked on its own.
    if (typeof via === "string") continue;
    const advisory = via.url?.split("/").pop();
    const exception = ACCEPTED.find((entry) => entry.advisory === advisory && entry.package === name);
    const coversAllPaths = exception && vulnerability.nodes.every((node) => exception.paths.includes(node));
    if (exception && coversAllPaths && today <= exception.expires) accepted.add(`${advisory} (${name}) until ${exception.expires}`);
    else rejected.push(`${name}: ${via.title} ${via.url} [${vulnerability.nodes.join(", ")}]${exception && today > exception.expires ? " — exception expired" : ""}`);
  }
}

for (const line of accepted) console.log(`accepted: ${line}`);
if (rejected.length > 0) {
  console.error(`npm audit found ${rejected.length} unaccepted advisories:\n${rejected.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("npm audit: no unaccepted production advisories.");
