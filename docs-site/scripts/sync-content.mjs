import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../Docs');
const destination = resolve(import.meta.dirname, '../src/content/docs');
const publicDirectory = resolve(import.meta.dirname, '../public');
const repository = resolve(import.meta.dirname, '../..');

if (!existsSync(source)) {
  throw new Error(`No se encontró la documentación pública en ${source}`);
}

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? markdownFiles(resolve(directory, entry.name))
      : entry.isFile() && entry.name.endsWith('.md') ? [resolve(directory, entry.name)] : [])
    .sort();
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// The synced copies are not tracked by Git, so Starlight cannot derive the
// edit link or the last-updated date on its own. Both are injected into the
// frontmatter here, from the public source in `Docs/` and its Git history.
const editBase = 'https://github.com/Micoh18/setareh/edit/main/Docs/';

function lastCommitDate(file) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    return iso || undefined;
  } catch {
    return undefined;
  }
}

for (const file of markdownFiles(destination)) {
  const raw = readFileSync(file, 'utf8');
  const frontmatter = raw.match(frontmatterPattern);
  if (!frontmatter) continue;
  const relativePath = relative(destination, file).replaceAll('\\', '/');
  const lines = [];
  if (!/^editUrl:/m.test(frontmatter[1]) && relativePath !== '404.md') {
    lines.push(`editUrl: ${editBase}${relativePath}`);
  }
  const date = relativePath === '404.md' ? undefined : lastCommitDate(resolve(source, relativePath));
  if (date && !/^lastUpdated:/m.test(frontmatter[1])) {
    lines.push(`lastUpdated: ${date}`);
  }
  if (!lines.length) continue;
  writeFileSync(file, `---\n${frontmatter[1]}\n${lines.join('\n')}\n---\n${raw.slice(frontmatter[0].length)}`, 'utf8');
}

function parseDocument(file) {
  const raw = readFileSync(file, 'utf8');
  const frontmatter = raw.match(frontmatterPattern);
  const metadata = frontmatter?.[1] ?? '';
  const title = metadata.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? raw.match(/^#\s+(.+)$/m)?.[1] ?? 'Setareh Docs';
  const description = metadata.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const body = raw.slice(frontmatter?.[0].length ?? 0).trim();
  const relativePath = relative(source, file).replaceAll('\\', '/');
  const segments = relativePath.replace(/\.md$/, '').split('/').map((segment) => segment.toLowerCase());
  if (segments.at(-1) === 'index') segments.pop();
  const route = segments.length ? `/${segments.join('/')}/` : '/';
  return { title, description, body, route };
}

const documents = markdownFiles(source).map(parseDocument).filter((document) => document.route !== '/404/');
const indexLines = [
  '# Setareh Docs',
  '',
  'Documentación pública de Setareh, infraestructura de comercio verificable para agentes.',
  '',
  '## Documentos',
  '',
  ...documents.map((document) => `- [${document.title}](${document.route}): ${document.description || 'Documentación de Setareh.'}`),
  '',
  '## Límites',
  '',
  '- El MVP acepta sólo USDC en Stellar testnet.',
  '- Nunca se deben publicar secretos, claves privadas, datos personales ni receipts de pago.',
  '- La información operativa sensible permanece fuera de este sitio.',
  '',
];
const fullLines = [
  '# Setareh Docs — corpus para modelos de lenguaje',
  '',
  'Este archivo se genera desde la documentación pública versionada en `Docs/`. No incluye `.private-docs/`.',
  '',
  ...documents.flatMap((document) => [
    `## ${document.title}`,
    '',
    `URL canónica: ${document.route}`,
    '',
    document.body,
    '',
  ]),
];

mkdirSync(publicDirectory, { recursive: true });
writeFileSync(resolve(publicDirectory, 'llms.txt'), indexLines.join('\n'), 'utf8');
writeFileSync(resolve(publicDirectory, 'llms-full.txt'), fullLines.join('\n'), 'utf8');
