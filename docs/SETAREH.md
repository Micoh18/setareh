# Setareh

## Resumen

Setareh convierte la operación de una tienda Web2 en capacidades que un agente puede descubrir, entender, pagar y ejecutar. Su primer conector es Shopify y su primer comercio de demostración es Micohstore, una tienda de crochet de piezas únicas.

No es un marketplace que simula compras ni otro catálogo genérico de APIs. Setareh ejecuta una orden de compra en el backoffice que ya usa el comercio: una vez confirmado el pago, crea una orden real dentro de Shopify, conserva la variante comprada, la dirección de envío y el comprobante de pago Stellar.

## Problema

Los agentes pueden recomendar productos, pero no pueden comprar de forma segura en comercios Web2 sin una cuenta humana, una tarjeta, credenciales de proveedor o automatización frágil del navegador. Los comercios, por otro lado, tienen catálogo, inventario y fulfillment en Shopify, pero no una interfaz confiable para agentes.

Las piezas artesanales muestran este problema muy bien: una unidad puede ser irrepetible. Decir que está disponible sin consultar stock, o anunciar una compra sin crearla en el sistema del comercio, rompe la confianza.

## Propuesta

> Setareh es la capa de comercio que permite que un agente encuentre, cotice, pague y cree órdenes reales en tiendas conectadas.

Stellar aporta pagos programáticos y verificables de bajo costo. Shopify se mantiene como fuente de verdad para productos, variantes, inventario, órdenes y fulfillment.

## Roles

| Rol | Qué hace |
| --- | --- |
| Comercio | Instala la app, autoriza permisos, selecciona qué productos expone y configura reglas. |
| Cliente/agente | Busca productos, pide una cotización y paga sólo dentro de los límites permitidos. |
| Setareh | Normaliza datos, aplica políticas, verifica el pago y ejecuta la orden Shopify. |
| Shopify | Mantiene catálogo, stock, pedido, envío y fulfillment. |
| Stellar/x402 | Transporta y acredita la autorización de pago programático. |

## Flujo de una orden real

```text
Agente solicita “un regalo lila bajo $30.000”
  → Setareh consulta productos y variantes reales de Shopify
  → Setareh devuelve opciones y stock actual
  → el agente elige una variante y solicita una cotización con dirección
  → Setareh crea un borrador de orden, calcula el total y lo vence en minutos
  → Stellar/x402 confirma el pago autorizado
  → Setareh completa el borrador o crea una orden Shopify
  → Shopify devuelve order_id y número de orden reales
  → Setareh devuelve orden, recibo Stellar y estado de envío al agente
```

La cotización es obligatoria: protege contra diferencias de precio, stock o despacho entre la búsqueda y el pago. Toda acción de crear una orden usa una clave de idempotencia para que un reintento del agente no genere dos ventas.

## Integración Shopify

Setareh será una Shopify App instalable por OAuth/managed installation, no una app con tokens manuales pegados por el comercio. La app almacena los tokens cifrados en servidor y solicita sólo los scopes necesarios:

```text
read_products
read_inventory
write_draft_orders
write_orders
read_orders
```

La implementación inicial usa `draftOrderCreate` para fijar los items y la dirección, y `draftOrderComplete` tras confirmar el pago. Como alternativa, puede usar `orderCreate` para casos donde Setareh crea la orden directamente. El hash de la transacción Stellar se registra en el recibo/nota de la orden y en la base de datos de Setareh.

### Estado de la orden

```text
quoted → payment_pending → payment_confirmed → creating_shopify_order
→ created → fulfillment_in_progress → fulfilled
```

Si Shopify rechaza la creación tras un pago confirmado, la orden queda en `manual_review`; no se afirma al agente que compró el producto. Una siguiente versión puede emitir un reembolso o usar escrow, pero no forma parte del MVP.

## Interfaz para agentes

Setareh ofrece las mismas capacidades por MCP y por HTTP/x402. MCP hace que un runtime de agentes pueda invocar funciones estructuradas; HTTP/x402 hace que esas capacidades sean descubribles y pagables por el ecosistema Bazaar.

```ts
searchProducts({ query, collection?, maxPriceClp?, deliveryZone? })
createQuote({ variantId, quantity, shippingAddress })
payAndPlaceOrder({ quoteId, paymentAuthorization })
getOrderStatus({ orderId })
```

Un agente jamás accede al token de Shopify. Setareh aplica la lista de colecciones permitidas, máximo por orden, zonas de envío y si cada compra requiere aprobación humana.

## Arquitectura MVP

```text
Micohstore / Shopify
    ↕ Admin GraphQL API + webhooks
Setareh API (TypeScript)
    ├─ conector Shopify
    ├─ catálogo normalizado y quotes
    ├─ política de compra e idempotencia
    ├─ verificación Stellar/x402
    └─ servidor MCP
    ↕
Agentes y Bazaar
```

La base de datos necesita `merchant`, `shopify_connection`, `product_cache`, `quote`, `payment`, `order` y `audit_event`. Shopify sigue siendo la fuente de verdad: la caché de Setareh es sólo para búsqueda rápida y se actualiza por webhooks de producto, inventario y orden.

## Seguridad y límites

- Nunca almacenar la clave privada de la wallet de un usuario o agente.
- Verificar red, activo, destinatario, monto, vencimiento y hash de cada pago antes de crear una orden.
- Cifrar tokens Shopify y validar las firmas de webhooks.
- Usar idempotencia en pagos y en creación de órdenes.
- Empezar con límites conservadores: un comercio, una moneda, productos preaprobados y confirmación humana opcional.
- Registrar un audit trail que vincule `quote_id`, autorización de pago, hash Stellar y `shopify_order_id`.

## Demo de hackatón

1. Micohstore tiene tres productos reales y una unidad de cada uno en una Shopify development store.
2. Un agente pide un regalo con restricciones de color, precio y despacho.
3. Setareh consulta catálogo e inventario, genera una cotización y solicita pago Stellar testnet.
4. Tras la confirmación, Setareh crea la orden real.
5. Se muestran la conversación del agente, el hash de Stellar y la orden nueva en Shopify Admin.

La demostración prueba que Setareh no sólo ayuda a agentes a hablar sobre productos: les permite participar en comercio físico con un sistema operativo de comercio existente.
