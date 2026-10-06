---
title: Mantener el portal de documentación
description: Cómo editar, compilar y publicar docs.setareh.site sin incluir material privado.
---

## Fuente única

Todo el contenido público vive en `Docs/` en la raíz del repositorio. El portal
Starlight toma esa carpeta como fuente durante el build. Las notas de trabajo,
paletas, decisiones internas, credenciales y datos operativos viven en
`.private-docs/`, que Git ignora y que el portal nunca copia.

No edites `docs-site/src/content/docs/`: es una copia generada. Tampoco edites
`docs-site/dist/`: es el resultado publicado.

## Desarrollo y compilación

```powershell
cd docs-site
npm.cmd install
npm.cmd run dev
```

Para crear la versión publicable:

```powershell
cd docs-site
npm.cmd run check:public-content
npm.cmd run build
```

El build hace tres cosas:

1. Copia `Docs/` al contenido que Starlight transforma en páginas.
2. Genera `llms.txt` y `llms-full.txt` desde el mismo contenido público.
3. Produce el sitio estático en `docs-site/dist/`, con búsqueda Pagefind y
   sitemap.

## Publicar en Hostinger

En el File Manager del sitio `docs.setareh.site`, abre `public_html` y sube el
contenido completo de `docs-site/dist/`, no la carpeta `dist` como nivel extra.
Incluye `index.html`, `_astro/`, `pagefind/`, las carpetas de rutas,
`llms.txt`, `llms-full.txt` y los archivos sitemap. La URL final debe ser:

```text
https://docs.setareh.site/
```

Tras cada publicación, verifica al menos `/`, `/primeros-pasos/`,
`/referencia/mcp/`, `/runbook/`, `/llms.txt` y `/llms-full.txt`.

## Revisión antes de publicar

- Ejecuta `npm.cmd run check:public-content` y `npm.cmd run build` sin errores.
- El CI ejecuta el mismo control de contenido antes de compilar. Detecta
  patrones conocidos de tokens Shopify, seeds Stellar y asignaciones de secretos;
  es una barrera adicional, no un reemplazo de la revisión humana.
- Comprueba que no haya secretos, direcciones de cliente, correos ni datos de
  pedido en `Docs/`.
- Usa enlaces relativos del sitio, por ejemplo `/seguridad/`.
- Confirma que una guía nueva aparezca en la navegación y en `llms.txt`.
