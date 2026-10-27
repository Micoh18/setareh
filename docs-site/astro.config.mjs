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
      // Starlight already emits og:title/description/url/site_name and
      // twitter:card; this adds the shared preview image every page lacked.
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.setareh.site/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content: 'Setareh Docs: comercio verificable para agentes. Traza quote, confirmación, settlement y orden en Stellar testnet.',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://docs.setareh.site/og.png' } },
      ],
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
