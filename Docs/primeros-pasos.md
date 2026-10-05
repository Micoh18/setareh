---
title: Primeros pasos
description: Configura y verifica una instancia local de Setareh para el flujo de demostración.
---

Setareh es un backend TypeScript que entrega una interfaz MCP y una API HTTP.
Conecta catálogo e inventario Shopify con un quote de monto fijo y un cobro
x402 en USDC sobre Stellar testnet.

## Requisitos

- Node.js 24 o superior.
- Una tienda Shopify de desarrollo o prueba con una app configurada.
- Scopes Shopify: `read_products`, `read_inventory`, `write_draft_orders`,
  `read_orders` y `write_orders`.
- Una cuenta Stellar testnet receptora con trustline de USDC testnet.
- Una wallet testnet de demo para el agente, también con trustline de USDC.

> Nunca uses una clave de mainnet ni dinero real con este MVP.

## Instalación local

```powershell
cd backend
Copy-Item .env.example .env
Copy-Item agent.env.example agent.env
npm.cmd install
```

`backend/.env` pertenece al servidor. Contiene las credenciales de Shopify, la
dirección pública que recibe USDC y las reglas del quote. `backend/agent.env`
pertenece exclusivamente a la wallet de demo: conserva ahí la clave privada
testnet del agente. Ambos archivos están excluidos de Git.

Consulta la [referencia de configuración](/referencia/configuracion/) antes de
completar las variables.

## Preflight obligatorio

```powershell
cd backend
npm.cmd run check
npm.cmd test
npm.cmd run doctor -- --verify
```

El último comando comprueba que existen las variables requeridas, puede buscar
una variante en Shopify, verifica los cinco scopes y consulta que el
facilitador anuncie settlement `exact` en `stellar:testnet`. No presentes ni
aceptes un pago si falla cualquiera de estas comprobaciones.

## Arranque

```powershell
cd backend
npm.cmd run dev
```

El proceso ofrece MCP por `stdio` y, con `PORT=4020`, expone la API HTTP.
Comprueba su estado en otra terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:4020/health
```

La respuesta esperada contiene `ok: true`, el servicio `setareh` y la red
`stellar:testnet`.

## Siguiente paso

- Si integras un agente: sigue [Checkout para agentes](/agentes/checkout/).
- Si conectas un comercio: sigue [Conectar Shopify](/comercios/shopify/).
- Si operas un demo: usa el [Runbook](/runbook/).
