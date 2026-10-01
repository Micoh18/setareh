# Guía Shopify para Micohstore

Esta guía crea una tienda de crochet funcional en Shopify desde cero. El objetivo inicial es tener productos, inventario, despacho y órdenes reales; después se conecta Setareh para que agentes puedan comprar bajo reglas seguras.

> No compartas contraseñas, códigos de verificación, claves API ni secretos de Shopify.

## Etapa 1: crear la cuenta y la tienda

1. Entra a [Shopify](https://www.shopify.com/) y crea una cuenta con tu correo.
2. Sigue el asistente inicial y selecciona que venderás **productos físicos**.
3. Usa **Micohstore** como nombre de la tienda.
4. Escoge una URL temporal clara, por ejemplo `micohstore.myshopify.com`.
5. Completa el país, moneda y datos básicos del negocio. Para Micohstore, usa Chile y CLP si venderás inicialmente desde Chile.
6. No conectes pagos reales todavía: primero armaremos y probaremos el catálogo.

Al entrar al administrador, verás un menú lateral. Las secciones principales que usaremos son **Products**, **Online Store** y **Settings**.

## Etapa 2: reunir la información de cada producto

Prepara esta información antes de cargar cada producto:

- nombre;
- precio en CLP;
- cantidad disponible;
- material;
- medidas;
- peso aproximado;
- color;
- tiempo de preparación;
- 3 fotos: portada, detalle y escala.

Ejemplo para una primera pieza única:

```text
Nombre: Mini bolso Mimo
Precio: $28.000 CLP
Stock: 1
Material: algodón reciclado
Medidas: 18 × 15 cm
Peso: 180 g
Color: lila
Preparación: 2 días hábiles
```

## Etapa 3: crear el primer producto

1. En Shopify Admin, abre **Products → Add product**.
2. Escribe el título y una descripción clara: material, medidas, uso y tiempo de preparación.
3. Sube la foto de portada primero. Shopify la mostrará como principal.
4. Añade las otras fotos: detalle de puntadas y una foto que muestre la escala.
5. Ingresa el precio.
6. Marca el artículo como producto físico.
7. Activa **Track quantity** e introduce el stock. Si es irrepetible, usa `1`.
8. Añade peso para el cálculo de envíos.
9. Guarda y abre la vista previa para comprobar el resultado.

Shopify será la fuente de verdad de imágenes, variantes e inventario. Sus URLs de imagen servirán también para la futura integración de Setareh.

## Productos agotados que se pueden hacer por encargo

Una pieza artesanal puede tener inventario `0` y seguir disponible como **hecha por encargo**. No debe mostrarse como “disponible para envío inmediato”.

En el producto o variante:

1. Mantén activado **Track quantity**.
2. Cuando la unidad lista se venda, deja la cantidad en `0`.
3. En la sección **Inventory**, activa **Continue selling when out of stock**.
4. Añade al título, descripción o una variante el texto claro: `Hecho por encargo · preparación: 7–10 días hábiles`.
5. En el campo de cantidad máxima por carrito, limita a una cantidad que realmente puedas producir durante ese plazo.

Shopify permite continuar vendiendo un producto aunque el inventario llegue a cero. Es útil para preventas y artículos hechos por encargo, pero debes comunicar el tiempo de preparación y no aceptar más pedidos de los que puedes producir. [Vender productos agotados](https://help.shopify.com/es/manual/products/inventory/setup/selling-when-out-of-stock)

Para Setareh, cada variante debe devolver uno de estos estados:

```text
LISTO_PARA_ENVIAR  → hay stock físico; se informa despacho normal.
HECHO_POR_ENCARGO  → stock 0, pero se permite vender; se informa plazo de producción.
AGOTADO            → stock 0 y no se permiten nuevas compras.
```

Ejemplo de respuesta correcta del agente:

> “El gato mago ya no está listo para envío inmediato, pero Mico puede hacerlo por encargo. Su preparación toma 7–10 días hábiles antes del despacho. ¿Quieres continuar?”

## Etapa 4: crear colecciones

Las colecciones ordenan la tienda y luego permiten decidir qué productos puede mostrar Setareh.

1. Ve a **Products → Collections**.
2. Crea estas colecciones iniciales:
   - Bolsos
   - Accesorios
   - Decoración
   - Piezas únicas
3. Añade manualmente los productos correspondientes.
4. Guarda cada colección.

Para comenzar, `Piezas únicas` es la más importante: evita que un agente ofrezca una unidad que ya se vendió.

## Etapa 5: personalizar la tienda

1. Entra a **Online Store → Themes**.
2. Conserva el tema gratuito Dawn para el primer lanzamiento.
3. Pulsa **Customize**.
4. Configura:
   - nombre o logo: Micohstore;
   - colores crema, coral, lila, cielo y verde suave;
   - una imagen de portada propia;
   - una colección destacada;
   - una sección corta “sobre Micohstore”.
5. Añade enlaces del menú: Inicio, Tienda, Piezas únicas y Contacto.

La landing estática del repositorio sirve como referencia visual: [index.html](../index.html). Más adelante se puede convertir a secciones del tema Shopify o a un storefront personalizado.

## Etapa 6: configurar envío y políticas

1. Abre **Settings → Shipping and delivery**.
2. Crea una tarifa inicial para Santiago y otra para regiones. Puede ser tarifa fija mientras se valida el negocio.
3. Ajusta el peso de productos si usarás tarifas calculadas por peso.
4. En **Settings → Policies**, escribe y publica políticas de:
   - envíos;
   - devoluciones;
   - privacidad;
   - contacto.
5. Deja la tienda protegida por contraseña hasta terminar las pruebas.

No publiques ni actives pasarelas de pago reales hasta revisar precios, stock, despacho y textos.

## Etapa 7: probar como cliente

1. Desde **Online Store**, abre la vista previa con el icono de ojo.
2. Navega hasta un producto.
3. Comprueba que se vean bien fotos, precio, descripción y stock.
4. Añádelo al carrito.
5. Verifica que la tarifa de despacho se comporte como esperas.

Una vez listo, conecta tu dominio propio y un medio de pago aprobado para Chile antes de quitar la contraseña.

## Etapa 8: preparar la integración con Setareh

Cuando Micohstore tenga al menos tres productos reales:

1. Instala la Shopify App de Setareh.
2. Autoriza permisos para leer catálogo e inventario y crear órdenes; la app nunca solicitará tu contraseña.
3. Selecciona las colecciones que permites comprar por agentes, por ejemplo `Piezas únicas`.
4. Configura límites: monto máximo, zonas de envío y si requiere aprobación humana.
5. Configura la wallet receptora para los pagos Stellar.

El flujo será:

```text
Agente busca producto
→ Setareh consulta Shopify
→ Setareh crea una cotización con vencimiento
→ pago Stellar confirmado
→ Setareh crea orden real en Shopify
→ Micohstore prepara y despacha normalmente
```

Lee la propuesta técnica completa en [SETAREH.md](SETAREH.md).

## Checklist antes de lanzar

- [ ] Nombre, logo y contacto visibles.
- [ ] Productos con precio, fotos, peso y stock.
- [ ] Colecciones creadas y visibles en el menú.
- [ ] Envíos configurados.
- [ ] Políticas de envío, devolución y privacidad publicadas.
- [ ] Checkout probado.
- [ ] Dominio y medio de pago configurados.
- [ ] Contraseña eliminada sólo al estar listo para vender.
