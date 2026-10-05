---
title: Estados y recuperación
description: Cómo interpretar una compra y conciliarla de forma segura sin duplicar pagos u órdenes.
---

## Estados normales

| Estado | Significado | Acción |
| --- | --- | --- |
| `quoted` | Draft y quote creados. | Presentar detalles; todavía no se ha pedido pago. |
| `payment_required` | Quote listo para entregar a la wallet. | Esperar una confirmación explícita. |
| `payment_submitted` | El facilitador está procesando. | No iniciar una segunda compra. |
| `payment_settled` | Settlement validado por Setareh. | El backend intenta completar Shopify. |
| `creating_shopify_order` | Un proceso posee la creación de orden. | Esperar o consultar estado. |
| `created` | Orden Shopify creada y evidencia adjuntada. | Comunicar éxito y guardar IDs operativos. |

## Estados de excepción

| Estado | Motivo | Respuesta segura |
| --- | --- | --- |
| `expired` | El quote venció. | Crear un quote nuevo; no pagar el anterior. |
| `payment_failed` | Settlement no se completó. | Revisar challenge, red, activo, fondos y trustline. |
| `out_of_stock` | Inventario cambió tras el pago. | Detener reintentos y revisar manualmente. |
| `manual_review` | Fallo después de un efecto irreversible o evidencia incompleta. | Conciliar antes de cualquier acción. |
| `shopify_failed` | Estado reservado para fallos de Shopify. | Tratarlo como revisión manual hasta tener evidencia. |

## Conciliar

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

## Regla de no duplicación

Nunca crees un segundo quote para “reintentar” un pago que podría haber sido
liquidado. Primero consulta `get_order_status` o concilia el `quoteId` original.
Setareh vincula un pago y una orden a cada quote para mantener idempotencia,
pero las personas que operan el sistema deben conservar esa misma disciplina.
