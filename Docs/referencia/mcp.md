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

## Servidor MCP del lado comprador

Las herramientas anteriores las sirve el backend del comercio y necesitan
sus credenciales de Shopify. Para un agente que **compra** desde otra máquina
el repositorio incluye un segundo servidor, `backend/src/agent-mcp.ts`, que
habla con la API pública por HTTPS y firma los pagos x402 con la wallet de
`backend/agent.env`. No necesita credenciales de Shopify y nunca devuelve la
clave secreta al agente.

Claude Code lo detecta solo gracias al archivo `.mcp.json` de la raíz del
repositorio. Para otro cliente MCP por `stdio`:

```toml
[mcp_servers.setareh]
command = "node"
args = ["backend/node_modules/tsx/dist/cli.mjs", "backend/src/agent-mcp.ts"]
cwd = "C:/ruta/a/setareh"
```

| Herramienta | Qué hace |
| --- | --- |
| `check_setup` | Verifica Node, `agent.env`, la API y la wallet (cuenta, XLM, trustline y saldo USDC) sin firmar nada |
| `search_catalog`, `check_availability` | Igual que las del comercio, vía `GET /v1/catalog` y `GET /v1/availability/:variantId` |
| `create_quote` | `POST /v1/quotes` con un `X-Request-Id` propio (`requestId` opcional) que vuelve en la respuesta |
| `pay_and_place_order` | Paga de verdad: pide el `402`, verifica red, activo y `AGENT_MAX_USDC`, firma y crea la orden. Un quote ya pagado devuelve `rejected_before_payment` con `409` sin firmar, más un campo `meaning` en español que explica el rechazo |
| `get_order_status` | `GET /v1/orders/:quoteId` |
| `verify_payment` | Consulta pública del hash en Horizon testnet |

El servidor declara además `instructions` MCP: un guion del piloto que el
cliente entrega al modelo al conectar. Ahí vive la traducción de lo que dice
una persona no técnica ("¿está todo listo?", "págala otra vez") a la
herramienta correcta, la regla de reintentar con el mismo `quoteId` sin crear
otro quote, y los nombres de los siete archivos de evidencia. Por eso la guía
[Reproducir el piloto](/agentes/reproducir-el-piloto/) habla en español
corriente y no nombra herramientas.
