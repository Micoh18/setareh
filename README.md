# Setareh

Setareh conecta agentes con comercios que operan en Shopify. Permite descubrir productos reales, comprobar disponibilidad y crear órdenes bajo reglas de compra definidas por cada tienda.

Micohstore es la tienda de referencia de la demostración. Su storefront ya vive en Shopify; el tema exportado se conserva en [`micohstore-shopify-theme`](micohstore-shopify-theme).

## Repositorio

- [`index.html`](index.html): landing estática de Setareh.
- [`backend`](backend): servidor MCP TypeScript para Shopify.
- [`micohstore-shopify-theme`](micohstore-shopify-theme): tema Shopify de Micohstore basado en Dawn.
- [`docs`](docs): propuesta de producto, seguridad y guías de conexión.

## Estado del conector

El backend implementa la ruta de hackathon: el agente invoca directamente el MCP de Setareh para buscar catálogo y stock, crea un quote fijo y recibe una ruta HTTP x402. La wallet local del agente firma USDC en Stellar testnet; tras el settlement, Setareh completa una única orden Shopify y guarda el receipt y hash Stellar.

El MVP está limitado a Micohstore, USDC testnet, un máximo de 30 USDC, confirmación explícita y una tarifa de envío demo configurable. Bazaar, mainnet, tarjetas y custodia de wallets quedan fuera de esta entrega.

## Desarrollo del backend

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd run doctor -- --verify
npm.cmd run dev
```

Nunca subas `backend/.env` ni las credenciales de Shopify.

Consulta el [plan de implementación](docs/HACKATHON-IMPLEMENTATION.md) y el [runbook de demo](docs/HACKATHON-DEMO-RUNBOOK.md).
