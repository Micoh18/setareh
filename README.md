# Micohstore

Landing estática para una tienda de crochet conectable a Setareh. La dirección visual actual es un estudio/jardín de lana: tipografía editorial, tonos crema, coral, lila, cielo y verde, con tramas que evocan el tejido. Los elementos CSS son originales y provisionales, preparados para reemplazarse por fotos propias.

## Imágenes de productos

Para producción, las fotos deben vivir en Shopify (`Product.media` / CDN de Shopify) y Setareh debe consumir las URLs que Shopify expone. Esto centraliza catálogo e inventario en el comercio y aplica automáticamente sus transformaciones de tamaño.

Cloudinary es una buena alternativa si se necesita procesamiento editorial antes de subirlas. Coolify sirve para desplegar la landing o el backend de Setareh, pero no es un host/CDN de imágenes.

Los motivos visuales actuales son CSS y deben reemplazarse con las fotos reales de los productos al conectar el catálogo Shopify.

## Setareh

La propuesta técnica, flujo de órdenes reales y seguridad están en [docs/SETAREH.md](docs/SETAREH.md).

La preparación de fotografías y su futura sustitución por media real de Shopify está en [docs/MICOHSTORE-PHOTOGRAPHY.md](docs/MICOHSTORE-PHOTOGRAPHY.md).

La guía paso a paso para crear y configurar la tienda está en [docs/SHOPIFY-MICOHSTORE-GUIDE.md](docs/SHOPIFY-MICOHSTORE-GUIDE.md).
