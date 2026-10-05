---
title: Referencia MCP
description: Herramientas MCP disponibles para descubrir, cotizar y seguir una compra Setareh.
---

Setareh se expone como un servidor MCP por `stdio`. Configúralo de forma local:

```toml
[mcp_servers.setareh]
command = "npm.cmd"
args = ["run", "dev"]
cwd = "C:/ruta/a/setareh/backend"
```

## `search_catalog`

Busca variantes activas en Shopify; no cobra, no reserva stock.

```json
{ "merchantId": "micohstore", "query": "tortuga", "limit": 10 }
```

Devuelve productos, variantes, precio, SKU cuando existe y una evaluación de
disponibilidad. `limit` acepta de 1 a 25.

## `check_availability`

Vuelve a consultar Shopify antes de cotizar.

```json
{
  "merchantId": "micohstore",
  "variantId": "gid://shopify/ProductVariant/123",
  "quantity": 1
}
```

Los estados posibles son `READY_TO_SHIP`, `MADE_TO_ORDER` y `OUT_OF_STOCK`.
Para una pieza por encargo, informa el plazo antes de continuar; la consulta no
reserva inventario.

## `create_quote`

Crea un draft order, fija los importes y devuelve el `quoteId`.

```json
{
  "merchantId": "micohstore",
  "items": [{ "variantId": "gid://shopify/ProductVariant/123", "quantity": 1 }],
  "email": "cliente@example.com",
  "shippingAddress": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "address1": "Calle Ejemplo 123",
    "city": "Santiago",
    "country": "CL",
    "zip": "8320000"
  },
  "userConfirmed": true
}
```

Sólo úsala luego de que la persona haya confirmado que quiere cotizar esos
datos. La respuesta contiene total Shopify, total USDC, destinatario, tasa,
vencimiento y estado `quoted`.

## `pay_and_place_order`

Entrega el endpoint HTTP que debe pagar la wallet; no transmite una clave
privada a Setareh.

```json
{ "quoteId": "uuid-del-quote", "userConfirmed": true }
```

Antes de invocarla, muestra el resumen de la compra y obtén una confirmación
inequívoca. El endpoint resultante devolverá un desafío `402` y sólo completará
la orden cuando el settlement sea válido. Revisa [Checkout para agentes](/agentes/checkout/).

## `get_order_status`

Consulta el estado con el `orderId` local/Shopify o con el `quoteId` cuando hay
revisión manual.

```json
{ "orderId": "uuid-del-quote-u-order" }
```

La respuesta entrega estado, datos mínimos de la orden Shopify y un resumen
seguro de pago. No expone el receipt crudo del facilitador.
