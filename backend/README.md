# Setareh commerce backend

Servidor MCP y HTTP para comprar en Shopify mediante un quote fijo y USDC en Stellar x402.

## Flujo implementado

1. El agente usa `search_catalog` y `check_availability` por MCP.
2. Con autorización explícita crea un quote con `create_quote`.
3. `pay_and_place_order` devuelve el endpoint x402 del quote.
4. La wallet local del agente llama `POST /v1/quotes/:quoteId/pay-and-place`.
5. x402 solicita `402`, liquida USDC Stellar testnet y Setareh completa el draft order de Shopify una sola vez.

La clave privada de la wallet compradora no se configura ni se transmite a este servidor.

## Configuración

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run check
npm.cmd test
```

Completa en `.env` las credenciales Shopify, la dirección pública Stellar receptora y un tipo de cambio de demo `SETAREH_USDC_PER_CLP`. No uses una wallet con fondos reales.

`SETAREH_FX_SOURCE` etiqueta la fuente de ese tipo de cambio; ambos valores quedan congelados dentro de cada quote.

Para el MVP, `SETAREH_FLAT_SHIPPING_CLP` define un despacho fijo opcional: se añade al draft de Shopify y queda incluido en el total y el quote. No se promete cálculo automático de tarifas de Shopify.

Define `SETAREH_BASE_URL` con la URL pública del backend (o `http://127.0.0.1:4020` localmente) para que `pay_and_place_order` entregue al agente un endpoint pagable completo.

`PORT=4020` activa la superficie HTTP además del MCP stdio:

```text
GET  /health
GET  /v1/catalog?query=tortuga
GET  /v1/availability/:variantId?quantity=1
POST /v1/quotes
POST /v1/quotes/:quoteId/pay-and-place  # protegido por x402
GET  /v1/orders/:orderId
```

## Configuración MCP local

```toml
[mcp_servers.setareh]
command = "npm.cmd"
args = ["run", "dev"]
cwd = "C:/Users/tucar/Desktop/vibecoding-proyects/setareh/backend"
```

## Wallet del agente y pago de demo

Tras recibir el `quoteId` desde `pay_and_place_order`, el runtime del agente paga
la ruta x402. Para el demo se incluye un cliente de referencia que mantiene la
clave de la wallet fuera de Setareh:

```powershell
Copy-Item agent.env.example agent.env
# Edita agent.env con una clave secreta de una wallet Stellar testnet fondeada
npm.cmd run demo:pay -- <quoteId>
```

El cliente primero verifica el desafío `402`: acepta sólo `stellar:testnet`,
USDC testnet y un importe inferior a `AGENT_MAX_USDC`. Recién entonces firma y
reintenta la solicitud. En producción, sustituye ese CLI por la wallet o
runtime de agente elegido, conservando esas mismas verificaciones.

## Límites del MVP

- Stellar testnet y USDC solamente.
- Un comercio piloto: Micohstore.
- Un quote vence por defecto en diez minutos y tiene tope de 30 USDC.
- Un fallo de Shopify después de pago queda en `manual_review`; si Shopify alcanzó a crear la orden, su ID queda persistido para conciliación y nunca se responde como compra exitosa.
- La incorporación de pagos x402 directamente en metadatos MCP queda para una siguiente iteración; la ruta HTTP x402 es la ruta pagable actual.

Consulta el [runbook operativo público](../Docs/RUNBOOK.md) para preparar, ejecutar y conciliar una demo.
