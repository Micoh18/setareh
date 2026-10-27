import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.setareh.site',
  integrations: [
    starlight({
      title: 'Setareh Docs',
      description: 'Documentación pública de Setareh.',
      logo: {
        src: './src/assets/setareh-logo.png',
        alt: 'Emblema solar de Setareh',
      },
      favicon: '/setareh-logo.png',
      customCss: [
        '@fontsource/barlow-condensed/600.css',
        '@fontsource/barlow-condensed/700.css',
        '@fontsource/literata/400.css',
        '@fontsource/literata/400-italic.css',
        '@fontsource/literata/600.css',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/500.css',
        './src/styles/setareh.css',
      ],
      components: {
        Header: './src/components/Header.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Hero: './src/components/Hero.astro',
        PageTitle: './src/components/PageTitle.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
      },
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
            { slug: 'operaciones/despliegue' },
            { slug: 'operaciones/metricas' },
            { slug: 'seguridad' },
            { slug: 'agentes' },
            { slug: 'evidencia' },
          ],
        },
      ],
    }),
  ],
});
