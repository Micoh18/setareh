import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.setareh.site',
  integrations: [
    starlight({
      title: 'Setareh Docs',
      description: 'Documentación pública de Setareh.',
      disable404Route: true,
      defaultLocale: 'root',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      sidebar: [
        { slug: 'index' },
        {
          label: 'Empezar',
          items: [{ slug: 'primeros-pasos' }, { slug: 'arquitectura' }, { slug: 'runbook' }],
        },
        {
          label: 'Integrar',
          items: [
            { slug: 'referencia/configuracion' },
            { slug: 'referencia/mcp' },
            { slug: 'referencia/http-x402' },
            { slug: 'agentes/checkout' },
            { slug: 'comercios/shopify' },
          ],
        },
        {
          label: 'Operar',
          items: [
            { slug: 'operaciones/estados-y-recuperacion' },
            { slug: 'seguridad' },
            { slug: 'agentes' },
            { slug: 'portal-de-documentacion' },
          ],
        },
      ],
    }),
  ],
});
