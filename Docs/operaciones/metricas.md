---
title: Métricas
description: Qué mide Setareh en el camino quote → pago → orden y cómo leerlo.
---

Las métricas se derivan de la tabla `quote_event`, que registra cada cambio
de estado de un quote con su hora y el `correlationId` de la request que lo
causó. No requieren infraestructura adicional y sobreviven a reinicios.

```powershell
cd backend
npm.cmd run metrics
npm.cmd run metrics -- --since 2026-10-26T00:00:00Z
```

La salida es JSON con cuatro bloques.

## Embudo

| Campo | Significado |
| --- | --- |
| `quotes` | Quotes creados (`quoted`). |
| `challenged` | Quotes que recibieron el desafío `402` (`payment_required`). |
| `submitted` | Quotes con un pago reclamado y enviado al facilitador. |
| `settled` | Pagos liquidados y registrados. |
| `created` | Órdenes Shopify creadas con evidencia adjunta. |
| `quoteToSettled`, `settledToCreated`, `quoteToCreated` | Tasas de conversión entre esas etapas. |

Cada quote cuenta una vez por etapa alcanzada. Un `settledToCreated` menor que
1 significa que hay pagos sin orden: revisa `alerts`.

## Excepciones

Cantidad de quotes que pasaron por `expired`, `payment_failed`,
`payment_unknown`, `out_of_stock` y `manual_review`. `payment_unknown` y
`manual_review` siempre merecen una persona; ver
[Estados y recuperación](/operaciones/estados-y-recuperacion/).

## Latencias

p50 y p95 en milisegundos, con el número de muestras:

| Tramo | Qué mide |
| --- | --- |
| `submittedToSettled` | Tiempo del facilitador Stellar en liquidar. |
| `settledToCreated` | Tiempo de Shopify en completar el draft y recibir la evidencia. |
| `quotedToCreated` | Experiencia completa del comprador. |

## Alertas

- `stuck`: quotes que llevan más de cinco minutos en `payment_submitted`,
  `payment_settled` o `creating_shopify_order`. Ninguno debería quedarse ahí:
  son señal de un proceso interrumpido. Se resuelven con `reconcile:stuck`.
- `needsReview`: quotes en `payment_unknown`, `manual_review` u
  `out_of_stock`, con la fecha desde la que esperan.

Estas alertas están pensadas para revisión manual periódica. El piloto no
incluye monitoreo 24/7 ni SLA.
