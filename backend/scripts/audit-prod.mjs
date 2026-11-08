// Runs `npm audit --omit=dev` and fails on every advisory except the accepted ones below.
// Each exception is pinned to one advisory, one package path and an expiry date, so it
// cannot silently cover a new vulnerability or outlive its review.
import { execFileSync } from "node:child_process";

const ACCEPTED = [
  // Empty since 2026-11-07: @x402 2.30 depends on zod 4, so GHSA-mrhx-c7xc-m3w5 (zod 3) no longer applies.
  // Shape of an entry: { advisory, package, paths: [...], expires: "YYYY-MM-DD", reason }.
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
