---
title: Estados y recuperación
description: Cómo interpretar una compra y conciliarla de forma segura sin duplicar pagos u órdenes.
---

## Estados normales

| Estado | Significado | Acción |
| --- | --- | --- |
| `quoted` | Draft y quote creados. | Presentar detalles; todavía no se ha pedido pago. |
| `payment_required` | Quote listo para entregar a la wallet. | Esperar una confirmación explícita. |
| `payment_submitted` | Un único intento de pago reclamó el quote y el facilitador lo procesa. | No iniciar una segunda compra; cualquier otro pago del mismo quote se rechaza sin llegar al facilitador. |
| `payment_settled` | Settlement validado por Setareh. | El backend intenta completar Shopify. |
| `creating_shopify_order` | Un proceso posee la creación de orden. | Esperar o consultar estado. |
| `created` | Orden Shopify creada y evidencia adjuntada. | Comunicar éxito y guardar IDs operativos. |

## Estados de excepción

| Estado | Motivo | Respuesta segura |
| --- | --- | --- |
| `expired` | El quote venció. | Crear un quote nuevo; no pagar el anterior. |
| `payment_failed` | El facilitador rechazó el pago de forma explícita y sin enviar transacción, o la conciliación probó que no hubo cobro. | Revisar challenge, red, activo, fondos y trustline; crear un quote nuevo. |
| `payment_unknown` | El settlement no terminó con una respuesta definitiva: timeout, error de red, respuesta inválida o transacción enviada sin confirmar. Los fondos pueden haberse movido. | No pagar de nuevo ni crear otro quote. Ejecutar `reconcile:payment`. |
| `out_of_stock` | Inventario cambió tras el pago. | Detener reintentos y revisar manualmente. |
| `manual_review` | Fallo después de un efecto irreversible (por ejemplo, Shopify falla tras el pago o el settlement no pudo registrarse) o evidencia incompleta. | Conciliar antes de cualquier acción. |
| `shopify_failed` | Estado reservado para fallos de Shopify. | Tratarlo como revisión manual hasta tener evidencia. |

## Vencimiento durante el pago

El vencimiento del quote sólo impide iniciar pagos nuevos. Si el quote vence
mientras su settlement ya está en curso, el pago se registra igual y la orden
continúa; un pago confirmado nunca se descarta por haber llegado tarde.

## Conciliar un pago incierto (`payment_unknown`)

Setareh guarda de cada intento fallido sólo datos derivados de la autorización
firmada: pagador, destinatario, monto y ledger de expiración. Con ellos el
comando consulta la red Stellar y decide sin adivinar:

```powershell
cd backend
npm.cmd run reconcile:payment -- <quoteId>            # sólo informa
npm.cmd run reconcile:payment -- <quoteId> --apply    # aplica paid/unpaid
npm.cmd run reconcile:payment -- <quoteId> --tx <hash>
```

| Veredicto | Significado | Con `--apply` |
| --- | --- | --- |
| `paid` | Hay una transacción exitosa con una transferencia USDC del monto exacto al comercio. | Registra el pago y crea la orden Shopify por el camino idempotente. |
| `unpaid` | No hay transferencia y la autorización del comprador ya expiró en la red, así que ya no puede cobrarse. | Cierra el quote como `payment_failed`. |
| `pending` | Todavía no hay transferencia, pero la autorización sigue vigente (normalmente alrededor de un minuto). | Nada; repetir después del ledger indicado. |
| `ambiguous` | Más de una transferencia coincide. | Nada; elegir la correcta y repetir con `--tx`. |
| `needs_operator` | Datos inconsistentes, hash que no coincide o intento fuera de la retención del RPC. | Nada; buscar la transacción en un explorador y repetir con `--tx`. |

Cualquier veredicto distinto de `paid` o `unpaid` termina con código de salida 2
y no modifica nada. Una transacción nunca se asigna a dos quotes. La retención
de eventos del RPC público de testnet es de unos 7 días; para intentos más
antiguos hace falta `--tx`.

## Conciliar una orden

Para conocer un draft de Shopify:

```powershell
cd backend
npm.cmd run reconcile:draft -- gid://shopify/DraftOrder/<id>
```

Para recuperar una orden ya pagada con su `quoteId`:

```powershell
cd backend
npm.cmd run reconcile:order -- <quoteId>
```

El segundo comando consulta el draft, persiste la orden cuando existe e intenta
adjuntar la evidencia. Úsalo sólo después de confirmar que hay un pago liquidado
para ese quote.

## Fichas por escenario

Cada fila es un escenario probado automáticamente en CI (matriz de fallos de
la semana 2). "Garantía" es lo que Setareh asegura sin intervención.

| Escenario | Estado final | Garantía | Cómo confirmarlo | Acción |
| --- | --- | --- | --- | --- |
| Dos pagos concurrentes del mismo quote | Uno liquida; el otro recibe `409` antes de llegar al facilitador | Un solo cobro | Log `quote.status` con un único paso a `payment_submitted` | Ninguna |
| Reintento tras una compra exitosa | Devuelve la misma orden | Ni segunda orden ni segundo cobro | `get_order_status` | Ninguna |
| El facilitador rechaza el pago explícitamente | `payment_failed` | No hubo cobro | Log `payment.failed` con `reason` | Crear un quote nuevo |
| Facilitador con timeout, caído o respuesta inválida | `payment_unknown` | El quote queda bloqueado para nuevos pagos | Log `payment.unknown` con `reason` | `reconcile:payment` |
| El quote vence durante el settlement | El pago se registra y la orden continúa | El pago no se pierde | `payment.settled` después de `expiresAt` | Ninguna |
| Shopify falla al completar el draft tras el pago | `manual_review`, pago guardado, sin orden | Sin segundo cobro | `http.error` y `quote.status` → `manual_review` | `reconcile:order` |
| Shopify completó la orden pero la respuesta se perdió | `manual_review` | Una sola orden | `reconcile:order` encuentra la orden en el draft | `reconcile:order` |
| Falla adjuntar la evidencia tras crear la orden | Orden en `manual_review` con su ID guardado | Sin segunda orden | Fila en `orders` con estado `manual_review` | `reconcile:order` |
| Stock agotado entre el pago y la orden | `out_of_stock`, pago guardado | Shopify no se llama | `quote.status` → `out_of_stock` | Revisión manual; reembolso fuera de banda |
| Proceso reiniciado a mitad del pago o de la orden | `payment_submitted` o `creating_shopify_order` por más de 5 minutos | Nada se repite solo | `reconcile:stuck` o `metrics` → `alerts.stuck` | `reconcile:stuck --apply` |
| Shopify limita o responde `5xx` en lecturas | Reintento acotado con backoff | Sin efectos duplicados | Log `shopify.call` con `attempt` > 1 | Ninguna |
| Payload liquidado con monto, red, activo o destino distintos | `manual_review` | Nunca se crea la orden | Log `payment.unrecorded` | Revisión manual |

## Quotes atascados tras un reinicio (`reconcile:stuck`)

Un quote no debería pasar más de cinco minutos en `payment_submitted`,
`payment_settled` o `creating_shopify_order`. Si el proceso se reinició en
medio de un pago o de una orden, queda ahí.

```powershell
cd backend
npm.cmd run reconcile:stuck                      # lista, sin cambios (sale con código 2 si hay alguno)
npm.cmd run reconcile:stuck -- --apply           # resuelve todos
npm.cmd run reconcile:stuck -- --quote <quoteId> --apply
```

| Estado atascado | Con `--apply` |
| --- | --- |
| `payment_submitted` | Pasa a `payment_unknown` conservando pagador y expiración de la autorización; después, `reconcile:payment`. |
| `creating_shopify_order` | Consulta el draft: si ya tiene orden, la adopta y adjunta la evidencia; si no, vuelve a `payment_settled` y crea la orden una vez. |
| `payment_settled` | Crea la orden por el camino idempotente normal. |

## Historial de estados

Cada transición de un quote queda en la tabla `quote_event` con el estado
anterior, el nuevo, la hora y el `correlationId` de la request que la causó, y
se registra también en los logs como `quote.status`. Es la primera fuente para
reconstruir qué pasó con una compra antes de conciliar.

## Regla de no duplicación

Nunca crees un segundo quote para “reintentar” un pago que podría haber sido
liquidado. Primero consulta `get_order_status` o concilia el `quoteId` original;
si el estado es `payment_unknown`, usa `reconcile:payment` antes que nada.
Setareh vincula un pago y una orden a cada quote para mantener idempotencia,
pero las personas que operan el sistema deben conservar esa misma disciplina.
