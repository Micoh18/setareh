---
title: Checkout para agentes
description: Cómo un runtime de agente usa MCP, x402 y una wallet local sin perder controles de gasto.
---

## Principio de confirmación

Un agente puede buscar y comprobar disponibilidad sin autorización de compra.
Antes de pagar debe mostrar el quote activo: artículos, cantidades, dirección,
total Shopify, total USDC, destinatario y vencimiento. Sólo después de una
confirmación inequívoca puede llamar `pay_and_place_order` con
`userConfirmed: true`.

Si la persona cambia artículo, cantidad, dirección o presupuesto, o expresa
duda, el agente no paga. Crea un quote nuevo y vuelve a presentar el resumen.

## Secuencia recomendada

1. `search_catalog` para encontrar variantes.
2. `check_availability` para la cantidad que se desea comprar.
3. `create_quote` con dirección y confirmación de creación del quote.
4. Presentar el resultado y pedir confirmación de pago.
5. `pay_and_place_order` para recibir el endpoint x402.
6. La wallet hace el primer `POST`, lee el desafío `402`, valida sus límites y
   firma localmente sólo si lo acepta.
7. Reintenta el `POST` con x402 y conserva `quoteId` para seguimiento.
8. `get_order_status` para comunicar el resultado sólo cuando la orden fue
   creada, o para detectar `manual_review`.

## Controles mínimos de la wallet

La wallet no debe delegar estas decisiones en texto generado por un modelo:

- permitir únicamente `stellar:testnet` en este MVP;
- permitir únicamente el identificador canónico de USDC testnet;
- comparar `payTo` y monto con el quote que el usuario vio;
- limitar el gasto por pago con `AGENT_MAX_USDC`;
- rechazar un challenge sin `payment-required` válido;
- mantener la clave privada local y nunca añadirla a prompts, MCP o HTTP.

La implementación compara el requisito x402 con `USDC_TESTNET_ADDRESS` de
`@x402/stellar`; no reemplaces esa comprobación por la etiqueta `USDC` ni por
un identificador construido a mano. En x402 sobre Stellar, los pagos usan el
token SEP-41 indicado por el desafío. Al fondear una cuenta con el activo
clásico USDC, Stellar documenta el uso de un identificador `CODE:ISSUER` y de
una trustline para recibirlo. [x402 en Stellar](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/pay-for-apis-x402/), [activos y trustlines](https://developers.stellar.org/docs/build/guides/transactions/path-payments/)

## Cliente de referencia

El repositorio incluye un pagador local para testnet:

```powershell
cd backend
npm.cmd run demo:pay -- <quoteId>
```

Ese cliente obtiene primero el desafío, verifica red, activo y límite, y sólo
entonces configura el firmante Ed25519 para el reintento x402. Es una referencia
de seguridad para integrar otra wallet; no es una custodia de producción.

## Resultado y lenguaje seguro

Di “orden creada” solamente si Setareh devuelve `created` y un identificador de
orden Shopify. Si el resultado es `payment_failed`, `out_of_stock` o
`manual_review`, explica el estado sin prometer una compra y deriva al proceso
de [recuperación](/operaciones/estados-y-recuperacion/).
