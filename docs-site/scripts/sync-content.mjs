import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../Docs');
const destination = resolve(import.meta.dirname, '../src/content/docs');
const publicDirectory = resolve(import.meta.dirname, '../public');

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

function parseDocument(file) {
  const raw = readFileSync(file, 'utf8');
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
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
