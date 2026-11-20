# Logo de Setareh

Exportado desde Figma el 2026-11-19. Emblema "león y sol" en un solo color, sin contorno, sin degradado, sin sombra. Esta carpeta es la fuente para cualquier uso nuevo (redes, prensa, kits de programa, presentaciones).

| Archivo | Qué es | Dónde usarlo |
| --- | --- | --- |
| `emblema.svg` · `emblema.png` (512) · `emblema@1024.png` | Emblema en terracota `#B5532A` sobre transparente | Fondos claros: crema `#F6EEDF`, blanco, fotografía clara |
| `emblema-claro.svg` · `emblema-claro.png` (1024) | Emblema en crema `#F6EEDF` sobre transparente | Fondos oscuros: café `#1E1611`, terracota `#A84B24`, video |
| `silueta.svg` | Emblema como un solo trazado relleno | Recortes, sellos, grabado, favicon monocromo |
| `avatar.svg` · `avatar.png` (400) | Emblema crema sobre cuadrado terracota `#A84B24`, sin esquinas redondeadas | Foto de perfil en X, YouTube, GitHub, Notion |
| `favicon.svg` · `favicon.png` (512) | Emblema crema sobre cuadrado terracota con esquinas redondeadas (radio 112) | Favicon, app icon, apple-touch-icon |
| `lockup-horizontal.svg` · `lockup-horizontal.png` (329×100) · `lockup-horizontal@4x.png` | Emblema más la palabra "Setareh" en Fraunces, terracota | Cabeceras, firmas, portadas sobre fondo claro |
| `lockup-horizontal-claro.svg` · `lockup-horizontal-claro.png` | El mismo lockup en crema | Cabeceras sobre fondo oscuro |

Las variantes `-claro` y los PNG grandes se generaron a partir de los SVG exportados (cambio de relleno y render con sharp); si Figma vuelve a exportar, regenerarlas.

Reglas (de `.private-docs/brand/SETAREH-BRAND-GUIDELINES.md`): un solo color por pieza, nunca sobre fotografía sin una capa oscura al 70 %, no rotar ni contornear ni añadir brillos. Colores y tipografías en `../../tokens.css`.

Los archivos `../setareh-emblema.svg`, `../favicon.svg` y `../favicon.png` son la exportación anterior (6 nov) y son los que hoy importan el portal, la landing y el README. Cambiarlos por estos es un PR aparte: hay que copiar también a `docs-site/public/` y `landing/public/` y volver a desplegar.
