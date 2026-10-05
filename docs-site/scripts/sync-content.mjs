import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../Docs');
const destination = resolve(import.meta.dirname, '../src/content/docs');

if (!existsSync(source)) {
  throw new Error(`No se encontró la documentación pública en ${source}`);
}

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
