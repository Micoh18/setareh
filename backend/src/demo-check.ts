import { checkSetup, loadAgentEnv, redactSecret } from "./agent-wallet.js";

/** Pre-flight for the reference agent: `npm run demo:check`. Signs nothing, prints no secret. */
const env = loadAgentEnv();

checkSetup(env)
  .then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  })
  .catch((error: unknown) => {
    console.error(redactSecret(error instanceof Error ? error.message : String(error), env.secret));
    process.exitCode = 1;
  });
