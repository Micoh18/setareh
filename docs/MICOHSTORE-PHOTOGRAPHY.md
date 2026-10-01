# Micohstore: guía para reemplazar los visuales provisionales

La landing tiene una estructura y lenguaje visual original. Para que su identidad sea realmente la de Mico Crochet, el siguiente cambio debe partir de fotos propias de los productos, no de imágenes genéricas de crochet.

## Fotos necesarias

Para cada producto, preparar tres tomas:

1. **Portada vertical:** producto completo, fondo claro y luz natural indirecta.
2. **Detalle:** primer plano de puntadas, textura y terminaciones.
3. **Escala:** producto junto a una mano, bolso, llaves o escritorio para mostrar tamaño.

Usar formato 4:5 o cuadrado, luz suave y fondos consistentes. El contraste entre hilo, color y superficie es parte de la sensación hecha a mano.

## Al subirlas a Shopify

1. Abrir el producto en **Products**.
2. Cargar la portada primero; Shopify la usará como imagen principal.
3. Añadir los detalles y la toma de escala como media adicional.
4. Completar el alt text con nombre, color y tipo de producto.
5. Mantener el seguimiento de inventario activado para una pieza única.

Shopify debe ser el origen de las imágenes: su CDN entrega versiones optimizadas y Setareh puede consultar la misma URL que ve el cliente.

## Sustitución en esta landing

Los bloques `.product-image` de `index.html` son marcadores visuales. Cuando estén las fotos, se reemplazan por una imagen de producto Shopify o una etiqueta `<img>` con `object-fit: cover`; no habrá que cambiar precios, stock ni la lógica de Setareh.

## Referencia de Instagram

Para alinear paleta, encuadre y tono con `@micocrochet18`, hacen falta tres a cinco capturas representativas o las fotos originales. Se usarán sólo como referencia creativa; los assets finales de la tienda deben seguir siendo fotos propias de Micohstore.
