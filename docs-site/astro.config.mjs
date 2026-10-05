import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Setareh Docs',
      description: 'Documentación pública de Setareh.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      sidebar: [
        { slug: 'index' },
        {
          label: 'Operación',
          items: [{ slug: 'runbook' }],
        },
        {
          label: 'Para agentes',
          items: [{ slug: 'agentes' }],
        },
      ],
    }),
  ],
});
