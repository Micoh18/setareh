import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://setareh.site',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
