import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.setareh.site',
  integrations: [
    starlight({
      title: 'Setareh',
      description: 'Documentación pública de Setareh.',
      logo: {
        src: '@setareh/brand/assets/setareh-emblema.svg',
        alt: 'Emblema león y sol de Setareh',
      },
      favicon: '/favicon.svg',
      // Starlight already emits og:title/description/url/site_name and
      // twitter:card; this adds the shared preview image every page lacked.
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/favicon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.setareh.site/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content: 'Setareh Docs: comercio verificable para agentes. Quote fijado, confirmación humana, USDC en Stellar testnet y una sola orden Shopify.',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://docs.setareh.site/og.png' } },
      ],
      customCss: ['@setareh/brand/fonts.css', '@setareh/brand/tokens.css', './src/styles/setareh.css'],
      components: {
        Header: './src/components/Header.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        MobileMenuFooter: './src/components/MobileMenuFooter.astro',
        PageFrame: './src/components/PageFrame.astro',
        PageTitle: './src/components/PageTitle.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
        Footer: './src/components/Footer.astro',
        Pagination: './src/components/Pagination.astro',
        Hero: './src/components/Hero.astro',
      },
      disable404Route: true,
      defaultLocale: 'root',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      sidebar: [
        { slug: 'index', label: 'Inicio de la documentación' },
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
            { slug: 'agentes/reproducir-el-piloto' },
            { slug: 'agentes/reproducir-el-piloto-windows' },
            { slug: 'comercios/shopify' },
            { slug: 'agentes' },
          ],
        },
        {
          label: 'Operar',
          items: [
            { slug: 'operaciones/estados-y-recuperacion' },
            { slug: 'operaciones/despliegue' },
            { slug: 'operaciones/metricas' },
          ],
        },
        {
          label: 'Verificar',
          items: [{ slug: 'seguridad' }, { slug: 'evidencia' }],
        },
      ],
    }),
  ],
});
