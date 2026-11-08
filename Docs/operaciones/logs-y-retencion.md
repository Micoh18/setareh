---
title: Logs y retención de datos
description: Qué escribe Setareh en sus logs, qué redacta, dónde se guarda cada dato y por cuánto tiempo.
---

Los logs sirven para diagnosticar una compra por su `correlationId` sin
revelar quién compró ni con qué clave. La pista de auditoría durable es la base
de datos, no el stream de logs.

## Qué se escribe

- **Formato.** Una línea JSON por evento en `stderr` (stdout lleva el protocolo
  MCP). Campos fijos: `ts`, `level`, `event` y `correlationId` cuando existe.
- **Lista permitida.** Sólo se escriben estos campos; cualquier otro se descarta
  antes de serializar: `quoteId`, `orderId`, `shopifyOrderName`, `from`, `to`,
  `status`, `outcome`, `verdict`, `reason`, `errorCode`, `message`,
  `transactionHash`, `network`, `amount`, `method`, `route`, `httpStatus`,
  `durationMs`, `operation`, `attempt`, `tool`, `shop`, `action`, `transport`,
  `url`, `authMode`, `oauthRoutes`.
- **Redacción.** Todo texto pasa por filtros antes de escribirse: correos →
  `[email]`; seeds Stellar → `[stellar-secret]`; tokens de Shopify →
  `[shopify-token]`; cabeceras `Bearer`/`Basic` → `[credential]`; blobs
  codificados largos (pagos firmados, XDR) → `[blob]`. Los textos se truncan a
  300 caracteres.
- **Nunca se registran.** Variables de las llamadas a Shopify, argumentos de las
  tools MCP, cuerpos HTTP, direcciones de envío, el payload firmado x402, el
  receipt crudo del facilitador ni valores de configuración.
- **Errores `500`.** La respuesta al cliente es genérica; el detalle interno
  queda sólo en el log redactado bajo el `correlationId`.
- **Correlación.** Cada request HTTP y cada tool MCP recibe un `correlationId`
  (el `X-Request-Id` del cliente si es un token opaco, o un UUID). Se devuelve
  en la respuesta, acompaña cada línea de log y se persiste en `quote_event`.

Estas reglas están cubiertas por pruebas automáticas que fallan si un campo
fuera de la lista o un secreto sin redactar llega a una línea de log.

## Dónde se guarda cada dato y por cuánto tiempo

| Fuente | Contenido | Retención |
| --- | --- | --- |
| Stream de logs del servidor | Líneas JSON redactadas. | La del proveedor de despliegue: corta y no garantizada. Setareh no la extiende ni exporta automáticamente. |
| `quote_event` | Transiciones de estado por quote con `correlationId` y hora. Sin datos personales. | Mientras exista el piloto: es la pista de auditoría. |
| `payment_attempt` | Resultado de cada intento de pago: motivo, dirección pública del pagador, monto, ledger de expiración. | Mientras exista el piloto. |
| `quote`, `payment`, `orders` | Líneas, montos, correo y dirección de envío de la persona compradora, hash Stellar, receipt del facilitador, IDs de orden. | Hoy indefinida. Objetivo declarado más abajo. |
| Snapshots del volumen | Copia de la base de datos. | Valores por defecto del proveedor. Contienen datos personales y tokens cifrados, sin la clave de cifrado. |
| Métricas | Agregados por estado, latencias y tasas de error, calculados bajo demanda. Sin datos personales. | Se publican agregados en [Evidencia](/evidencia/). |
| Shopify | Draft, orden, nota, etiqueta `setareh` y metafield `setareh.stellar_payment`. | Política de Shopify y del comercio. |
| Stellar testnet | Transacciones públicas. | Permanente en la cadena; el RPC público conserva alrededor de 7 días consultables. |

## Política de retención

1. **Logs del servidor:** efímeros. Sólo se exportan para evidencia de un
   incidente o de una compra de evaluador, filtrados por `correlationId` y
   guardados en canales privados.
2. **Pista de auditoría (`quote_event`, `payment_attempt`):** se conserva
   mientras exista el piloto. No contiene datos personales.
3. **Datos personales de quotes (correo, dirección):** sólo hacen falta hasta
   que la orden existe en Shopify o el quote vence sin pago. Objetivo: purgar
   esos campos de los quotes vencidos sin orden a los 30 días del vencimiento y
   de los quotes con orden a los 90 días de creada la orden, conservando
   montos, estados y hash. **Estado: no implementado todavía**; figura como
   riesgo abierto en [Seguridad](/seguridad/).
4. **Receipt del facilitador:** se conserva como prueba del settlement y nunca
   se expone por API. Misma purga de 90 días una vez conciliada la orden.
5. **Evidencia pública:** sólo hashes, IDs de orden truncados, `quoteId`,
   agregados de métricas y lo que evaluadores y comercios autoricen por escrito.

## Cómo se entrega un extracto a un evaluador o a un comercio

1. Se pide el `quoteId` o el `X-Request-Id` que usó el cliente.
2. En el servidor se filtran los logs por ese `correlationId`, se consultan las
   filas de `quote_event` del quote y el estado público `GET /v1/orders/<quoteId>`.
3. Se revisa a mano que no aparezca correo, dirección, seed ni token, y se
   redacta el dominio de la tienda si no está autorizado.
4. El extracto se guarda con fecha UTC y commit del servicio en canales
   privados; en esta documentación sólo se publican hash, estado final y
   `quoteId`.
