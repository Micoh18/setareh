import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const outputDirectory = resolve(import.meta.dirname, '../dist');

function sourceRevision() {
  const fromCi = process.env.GITHUB_SHA?.trim();
  if (fromCi) return fromCi;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, 'build-info.json'),
  `${JSON.stringify({ sourceRevision: sourceRevision(), generatedAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
