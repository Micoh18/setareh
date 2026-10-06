import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../Docs');

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? markdownFiles(resolve(directory, entry.name))
      : entry.isFile() && entry.name.endsWith('.md') ? [resolve(directory, entry.name)] : []);
}

const checks = [
  {
    label: 'un token de acceso Shopify',
    pattern: /\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]+\b/g,
  },
  {
    label: 'una seed privada de Stellar',
    pattern: /\bS[A-Z2-7]{55}\b/g,
  },
  {
    label: 'una asignación de secreto Shopify',
    pattern: /\bSHOPIFY_(?:CLIENT_SECRET|ACCESS_TOKEN)\s*=\s*(?!["']?(?:<|YOUR_|REPLACE_|EXAMPLE_|\$|$))[^\s#]+/gi,
  },
  {
    label: 'una asignación de clave privada Stellar',
    pattern: /\bAGENT_STELLAR_PRIVATE_KEY\s*=\s*(?!["']?(?:<|YOUR_|REPLACE_|EXAMPLE_|\$|$))[^\s#]+/gi,
  },
];

const findings = [];
for (const file of markdownFiles(source)) {
  const content = readFileSync(file, 'utf8');
  for (const { label, pattern } of checks) {
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${relative(source, file)}:${line} contiene ${label}.`);
    }
  }
}

if (findings.length) {
  console.error('La documentación pública parece contener material sensible:');
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`Contenido público verificado: ${markdownFiles(source).length} archivos Markdown sin patrones de secretos conocidos.`);
