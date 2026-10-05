---
title: Runbook operativo
description: Preparación, ejecución, recuperación y cierre de una demostración de Setareh.
---

# Runbook operativo de Setareh

Este runbook describe cómo preparar, verificar y operar el flujo de compra de
Setareh en el entorno de demostración. No almacenes secretos, direcciones de
clientes, identificadores de pedidos ni datos de incidentes en este archivo.

## Alcance

Setareh permite que un agente consulte el catálogo Shopify, cree un quote con
vigencia limitada y liquide USDC en Stellar testnet mediante x402. Tras validar
el pago, el backend crea una orden en Shopify. El comercio piloto es
Micohstore.

El MVP opera sólo con `USDC` y `stellar:testnet`. No usar mainnet ni fondos
reales.

## Antes de iniciar

Necesitas Node.js 24 o superior, acceso autorizado a la app de Shopify del
comercio y una wallet Stellar testnet para el demo. Configura los secretos sólo
en archivos locales ignorados por Git:

```powershell
cd backend
Copy-Item .env.example .env
Copy-Item agent.env.example agent.env
npm.cmd install
```

Completa `backend/.env` con las credenciales de Shopify, la dirección pública
receptora de Stellar y los límites del quote. En `backend/agent.env` ingresa
únicamente la clave privada **testnet** de la wallet compradora. Nunca copies
estos valores a tickets, chats, commits ni documentación pública.

## Preflight

Desde `backend/`, ejecuta estas verificaciones antes de cualquier demo:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run doctor -- --verify
```

La última comprobación valida la conexión a Shopify, los scopes
`read_products`, `read_inventory`, `write_draft_orders`, `read_orders` y
`write_orders`, y que el facilitador x402 anuncie settlement `exact` para
`stellar:testnet`. Corrige cualquier fallo antes de aceptar pagos.

Confirma también que la wallet del agente tenga una trustline de USDC testnet y
que `AGENT_MAX_USDC` sea igual o menor al máximo permitido por Setareh.

## Arranque

Inicia el backend local:

```powershell
cd backend
npm.cmd run dev
```

Con `PORT=4020`, verifica que el servicio responda:

```powershell
Invoke-RestMethod http://127.0.0.1:4020/health
```

La respuesta debe indicar `ok: true` y la red `stellar:testnet`. Si el agente
necesita pagar por HTTP, `SETAREH_BASE_URL` debe ser una URL absoluta y
alcanzable por su wallet; no expongas el servidor local sin HTTPS y controles
de red apropiados.

## Ejecución de una compra de demo

1. Consulta catálogo y disponibilidad mediante MCP.
2. Crea un quote con artículos, cantidades, email y dirección válidos.
3. Confirma explícitamente la compra y revisa el total, moneda y vencimiento.
4. Ejecuta el cliente de referencia con el ID del quote:

   ```powershell
   npm.cmd run demo:pay -- <quoteId>
   ```

5. Conserva el `quoteId`, el estado resultante y el identificador de orden
   Shopify como evidencia operativa. No conserves ni publiques el receipt crudo
   del pago ni secretos de wallet.

El cliente de demo valida que el desafío x402 corresponda a USDC en Stellar
testnet, que el destinatario sea el configurado y que el importe respete el
límite local antes de firmar.

## Incidentes y recuperación

| Situación | Acción |
| --- | --- |
| Falla el preflight | No inicies una compra. Corrige configuración, scopes o facilitador y vuelve a ejecutar `doctor -- --verify`. |
| Quote vencido o stock insuficiente | Crea un quote nuevo; no reutilices ni modifiques un quote anterior. |
| Pago rechazado por x402 | Revisa red, activo, importe máximo y fondos/trustline de la wallet testnet. No reintentes a ciegas. |
| Pago liquidado pero orden en revisión | Detén nuevos intentos para ese quote y concilia antes de actuar manualmente. |
| Duda sobre estado de un draft | Ejecuta `npm.cmd run reconcile:draft -- gid://shopify/DraftOrder/<id>`. |
| Duda sobre una orden pagada | Ejecuta `npm.cmd run reconcile:order -- <quoteId>`. |

Un quote admite un pago y una orden. Ante reintentos, usa siempre el mismo
`quoteId` para consultar o conciliar, nunca para iniciar una compra paralela.

## Cierre de una demo

Registra de forma interna el resultado y elimina de las notas públicas
cualquier identificador de cliente, dirección, token o clave. Detén el proceso
local cuando termine la demo y confirma que no haya cambios de secretos ni de
base de datos preparados para commit:

```powershell
git status --short
```

Los borradores, notas operativas y cualquier información sensible deben vivir
en `.private-docs/`, que Git ignora.
