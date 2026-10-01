<p align="center">
  <img src="./logo.png" width="210" alt="Setareh logo: una estrella geométrica dorada" />
</p>

<h1 align="center">Setareh</h1>

<p align="center">
  <strong>Infraestructura de comercio verificable para agentes.</strong><br />
  Busca en Shopify, fija una cotización, liquida USDC en Stellar y crea una orden real.
</p>

<p align="center">
  <a href="#qué-resuelve">Producto</a> ·
  <a href="#flujo-de-compra">Flujo</a> ·
  <a href="#inicio-rápido">Inicio rápido</a> ·
  <a href="#seguridad-y-límites">Seguridad</a>
</p>

## Qué resuelve

Los agentes ya pueden recomendar productos, pero completar una compra física exige algo más que un checkout: stock real, una cotización que no cambie, límites de gasto, pago verificable y una orden que el comercio pueda preparar.

Setareh conecta esos componentes sin reemplazar al comercio:

- **Shopify** sigue siendo la fuente de verdad para catálogo, inventario, pedidos y fulfillment.
- **Setareh** entrega una interfaz MCP para que un agente busque, revise disponibilidad y cotice.
- **x402 + Stellar testnet** permiten que la wallet del agente liquide USDC sin entregar su clave privada al servidor.
- **SQLite e idempotencia** vinculan quote, pago y orden para impedir cobros u órdenes duplicadas.

El piloto de hackathon usa **Micohstore**, una tienda Shopify de productos artesanales. El flujo se validó de punta a punta con una orden Shopify real y una liquidación USDC en Stellar testnet.

## Flujo de compra

```text
Persona
  → Agente
  → MCP de Setareh: catálogo, stock y quote
  → confirmación en lenguaje natural
  → endpoint HTTP x402
  → wallet local del agente firma USDC en Stellar testnet
  → facilitador x402 liquida el pago
  → Setareh completa una única orden Shopify
  → orden Shopify + hash Stellar verificables
```

El pago no viaja todavía como metadata nativa de MCP: MCP inicia el flujo y devuelve un endpoint HTTP protegido por x402. La wallet llama ese endpoint, recibe el desafío `402`, firma localmente y reintenta la solicitud.

## Capacidades del MCP

| Herramienta | Propósito |
| --- | --- |
| `search_catalog` | Busca variantes activas en Shopify. |
| `check_availability` | Reconsulta stock y clasifica disponibilidad. |
| `create_quote` | Fija productos, dirección, total Shopify, conversión a USDC y vencimiento. |
| `pay_and_place_order` | Devuelve el endpoint HTTP x402 para la wallet del agente. |
| `get_order_status` | Devuelve el estado de Setareh, la orden Shopify y un resumen seguro del pago. |

Una confirmación se interpreta en contexto del último quote activo: respuestas como “sí”, “sí, compra”, “dale”, “hazlo” o “confirmo” bastan. Si cambian artículo, cantidad, dirección o presupuesto, el agente debe crear una cotización nueva.

## Inicio rápido

### Requisitos

- Node.js 24 o superior.
- Una app instalada en Shopify con `read_products`, `read_inventory`, `write_draft_orders`, `read_orders` y `write_orders`.
- Una wallet Stellar testnet receptora y una wallet local de demo con trustline USDC.

### Configuración

```powershell
cd backend
Copy-Item .env.example .env
Copy-Item agent.env.example agent.env
npm.cmd install
```

Completa `backend/.env` con las credenciales de Shopify, la dirección pública receptora Stellar y los parámetros del quote. En `backend/agent.env` configura únicamente la clave privada **testnet** de la wallet compradora. Ambos archivos están ignorados por Git.

### Verificación y arranque

```powershell
cd backend
npm.cmd run check
npm.cmd test
npm.cmd run doctor -- --verify
npm.cmd run dev
```

`doctor -- --verify` comprueba la conexión con Shopify, los scopes requeridos y que el facilitador anuncie settlement `exact` para `stellar:testnet`.

Para completar un quote ya aprobado desde la wallet de demo:

```powershell
npm.cmd run demo:pay -- <quoteId>
```

## Configuración MCP local

```toml
[mcp_servers.setareh]
command = "npm.cmd"
args = ["run", "dev"]
cwd = "C:/ruta/a/setareh/backend"
```

La herramienta `pay_and_place_order` devuelve una URL HTTP completa cuando `SETAREH_BASE_URL` está configurada.

## Seguridad y límites

- La clave privada de la wallet compradora nunca llega a Setareh.
- Sólo se acepta `USDC` en `stellar:testnet` durante el MVP.
- Cada quote vence y congela el total Shopify, el equivalente USDC y la tasa usada.
- El backend valida red, activo, monto y destinatario del pago antes de crear la orden.
- Hay un pago y una orden por quote, incluso ante reintentos concurrentes.
- Si Shopify falla después de liquidar, el flujo pasa a `manual_review`; si la orden ya fue creada, su ID queda persistido para conciliación.
- `get_order_status` no expone el receipt crudo del facilitador.

## Estructura del repositorio

```text
.
├── logo.png                    # identidad visual de Setareh
├── index.html / styles.css      # landing de Setareh
├── backend/                     # MCP, API HTTP x402 y lógica de comercio
│   ├── src/commerce.ts          # ciclo quote → pago → orden
│   ├── src/http.ts              # endpoint HTTP protegido por x402
│   ├── src/mcp.ts               # herramientas MCP
│   ├── src/shopify.ts           # cliente Shopify Admin API
│   └── src/doctor.ts            # preflight de demo
├── micohstore-shopify-theme/    # tema Shopify del comercio piloto
└── docs/                        # arquitectura, operación y material de hackathon
```

## Alcance del MVP

Setareh está diseñado para una hackathon y deliberadamente acotado: un comercio piloto, USDC testnet, quotes con tope configurable y una wallet de demo. Mainnet, tarjetas, descubrimiento mediante Bazaar, políticas avanzadas por colección/zona y custodia de wallets quedan fuera de esta versión.

Consulta el [documento técnico](docs/SETAREH.md), la [guía de conexión Shopify](docs/SETAREH-SHOPIFY-CONNECTION.md) y el README del [backend](backend/README.md) para más detalle.
