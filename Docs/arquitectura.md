---
title: Arquitectura y modelo de compra
description: Cómo cooperan el agente, Setareh, Shopify, Stellar y el facilitador x402.
---

## Responsabilidades

| Componente | Responsabilidad |
| --- | --- |
| Persona y agente | Descubrir productos, entregar datos de compra y confirmar explícitamente. |
| Setareh | Consultar Shopify, fijar el quote, validar el settlement y evitar duplicados. |
| Shopify | Fuente de verdad de catálogo, variantes, inventario, draft orders y órdenes. |
| Wallet del agente | Lee el desafío x402, aplica sus límites locales y firma el pago. |
| Facilitador x402 | Verifica y liquida el pago antes de que Setareh complete el draft. |
| Stellar testnet | Red de liquidación del MVP para USDC testnet. |

Setareh no recibe la clave privada de la wallet. Shopify tampoco se sustituye:
la orden final, sus datos de fulfillment y el inventario permanecen en el
backoffice del comercio.

## Shopify primero, no Shopify para siempre

El código del MVP usa un cliente Shopify directamente. Esa decisión permite
probar catálogo, inventario, borradores y órdenes con una sola fuente de verdad,
pero **no significa que Setareh ya soporte otras plataformas**.

La frontera de extensión prevista es un adaptador de comercio. Antes de sumar
otro canal, debe existir una implementación del adaptador y sus pruebas para:

1. buscar catálogo y variantes;
2. consultar disponibilidad para una cantidad concreta;
3. crear una cotización/borrador con el precio y despacho del comercio;
4. completar o crear la orden después de un settlement válido;
5. consultar la orden para recuperación y conciliación.

El núcleo de Setareh —políticas, quote con vencimiento, estado de pago,
idempotencia, auditoría y `manual_review`— debe conservar el mismo contrato
independientemente del adaptador. Un futuro conector para otro e-commerce,
backoffice propio o comercio físico tendrá su alcance, amenazas y pruebas
propios; no es una capacidad actual del MVP.

## Flujo de compra

```text
Agente ── busca catálogo / consulta stock ──► Setareh ──► Shopify
Agente ── crea quote confirmado ────────────► Setareh ──► Draft order Shopify
Wallet ◄── endpoint de pago x402 ──────────── Setareh
Wallet ── POST, desafío 402 y pago firmado ─► Facilitador x402 / Stellar testnet
Facilitador ── settlement válido ───────────► Setareh ──► Completa orden Shopify
Setareh ── orden y evidencia segura ────────► Agente
```

El quote captura los ítems, la dirección, el total de Shopify, el equivalente
USDC, la fuente de tasa y un vencimiento. No es sólo una estimación: el
servidor compara el desafío x402 contra ese quote antes de crear una orden.

## Estados

```text
quoted
  → payment_required
  → payment_submitted
  → payment_settled
  → creating_shopify_order
  → created
```

Los estados de excepción son `expired`, `out_of_stock`, `payment_failed` y
`manual_review`. Un estado de revisión nunca es éxito: se detienen los
reintentos y se concilia la orden con el mismo `quoteId`.

Consulta [Estados y recuperación](/operaciones/estados-y-recuperacion/) para
el significado operativo de cada uno.

## Límites deliberados del MVP

- Un comercio piloto por configuración.
- Sólo `USDC` en `stellar:testnet`.
- Quotes de duración y máximo USDC configurables.
- Despacho fijo opcional; no hay cotización dinámica de tarifas Shopify.
- No hay mainnet, devolución automática, custodia de wallets ni autenticación
  pública de la API lista para producción.
