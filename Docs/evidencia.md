---
title: Evidencia pública de referencia
description: Trazas verificables del entorno de referencia y límites de lo que demuestran.
---

## Alcance de esta evidencia

Estas transacciones son liquidaciones internas de referencia ejecutadas en
`stellar:testnet` durante el desarrollo de Setareh. Permiten comprobar que el
flujo técnico produjo transacciones exitosas en Stellar. **No** acreditan un
piloto independiente, una venta comercial, fulfillment de una orden ni uso en
mainnet.

No se publican IDs de quotes, direcciones, datos de la tienda, compradores,
productos ni receipts crudos. Esa separación permite hacer verificable la
liquidación sin exponer información operativa o personal.

## Transacciones Stellar testnet

| Fecha (UTC) | Activo y monto | Transacción | Ledger |
| --- | --- | --- | --- |
| 2026-10-01 18:55:47 | USDC testnet · 4.5000000 | [`ff6177…f65001`](https://horizon-testnet.stellar.org/transactions/ff61775d6db907bd3a5ede8a69f8fdb882693c0bd39e185d34ccbfba78f65001) | 4,971,472 |
| 2026-10-01 23:18:47 | USDC testnet · 15.0000000 | [`3063f6…4842be`](https://horizon-testnet.stellar.org/transactions/3063f64132db89c90d2bbf1a8b96f7801ac0837c68b6a9f84f380a7b424842be) | 4,974,628 |
| 2026-10-26 01:10:12 | USDC testnet · 15.0000000 | [`0f1260…d7d41f`](https://horizon-testnet.stellar.org/transactions/0f12600a192ef219137a667dde25631bc42bd26569dab066c256b88036d7d41f) | 5,390,685 |
| 2026-10-27 00:56:32 | USDC testnet · 10.0000000 | [`2faf68…bed52f`](https://horizon-testnet.stellar.org/transactions/2faf68f8e2946d26153a3658281486063b18508ff629173554df539864bed52f) | 5,407,801 |

Las dos últimas se ejecutaron contra el entorno publicado
(`api.setareh.site`) con el código de la semana 2, cada una seguida de un
reintento del mismo quote que fue rechazado con `409` sin segundo cobro ni
segunda orden; las órdenes Shopify resultantes son `#1003` y `#1004`. Todas
las trazas deben mostrar `successful: true` en Horizon. Stellar testnet puede
reiniciarse o borrar historial; esta página no debe interpretarse como
evidencia duradera de fondos reales.

## Artefactos públicos del MVP

- [Modelo de amenazas](/seguridad/): activos, límites, mitigaciones y riesgos
  residuales del flujo.
- [Runbook operativo](/runbook/): preparación, ejecución y recuperación.
- [CI del repositorio](https://github.com/Micoh18/setareh/actions/workflows/ci.yml): instala,
  audita dependencias de producción, verifica backend, revisa que `Docs/` no
  publique secretos y construye este portal.
- [`build-info.json`](/build-info.json): hash exacto del commit que produjo el
  sitio desplegado. Tras cada subida se debe comprobar que coincida con la
  revisión revisada en GitHub.

## Entorno de piloto y CI

Semana 1 del sprint: servicio desplegable, configuración por entorno, guía de
release y CI. Estado al 20 de octubre de 2026:

| Evidencia | Dónde comprobarla |
| --- | --- |
| URL del entorno HTTPS | `https://api.setareh.site/health` responde `{"ok":true,"service":"setareh","network":"stellar:testnet"}`; `http://` redirige con `301` |
| Guía de despliegue sin secretos | [Despliegue y release](/operaciones/despliegue/) |
| Configuración para agentes | [Usar el entorno publicado](/agentes/checkout/#usar-el-entorno-publicado) |
| CI por cambio | [Pull request #1](https://github.com/Micoh18/setareh/pull/1); ejecuciones en verde para `400fc93` ([run](https://github.com/Micoh18/setareh/actions/runs/39361385460)), `3b8e77a` ([run](https://github.com/Micoh18/setareh/actions/runs/39361595515)), `2082d9c` ([run](https://github.com/Micoh18/setareh/actions/runs/39445624748)), `c64e061` ([run](https://github.com/Micoh18/setareh/actions/runs/39468296438)) y `f92a28e` ([run](https://github.com/Micoh18/setareh/actions/runs/39477544196)); `main` cerró la semana en `27d9341` con CI en verde y sin advertencias ([run](https://github.com/Micoh18/setareh/actions/runs/39969922445)) |
| Pruebas automatizadas | 35 pruebas en `backend/src/*.test.ts`, incluidas OAuth (firma, dominio, cifrado, replay, renovación) y límite de peticiones |
| Instalación Shopify sin compartir secretos | La tienda de referencia instaló la app por OAuth el 20 de octubre de 2026; tokens cifrados y renovación automática verificados con el preflight dentro de la instancia |

Lo que esta evidencia no demuestra: ninguna compra de un evaluador externo,
ningún uso en mainnet y ninguna garantía de disponibilidad. El proveedor de
infraestructura y sus consolas no se publican.

## Matriz de fallos, logs y métricas

Semana 2 del sprint: pruebas automatizadas de fallos, logs estructurados con
correlación y métricas. Estado al 27 de octubre de 2026:

| Evidencia | Dónde comprobarla |
| --- | --- |
| Matriz de fallos automatizada | 13 escenarios con prueba en CI (concurrencia, reintentos, facilitador caído o con timeout, quote vencido durante el pago, Shopify caído tras el pago, stock agotado, reinicio del proceso, throttling, payload alterado); resumen en [Fichas por escenario](/operaciones/estados-y-recuperacion/#fichas-por-escenario) |
| Estados recuperables | `payment_unknown` para settlements sin respuesta definitiva, con conciliación contra la red ([`reconcile:payment`](/operaciones/estados-y-recuperacion/#conciliar-un-pago-incierto-payment_unknown)); `reconcile:stuck` para procesos interrumpidos |
| Logs redactados con correlación | Cada respuesta devuelve `X-Request-Id`; los logs son JSON con lista permitida y filtros de PII, claves y pagos firmados ([Seguridad](/seguridad/)); una prueba inyecta email, dirección, teléfono y un pago firmado y verifica que nada llegue a los logs ni a una respuesta `500` |
| Métricas | [Métricas](/operaciones/metricas/): embudo quote → pago → orden, excepciones, latencias y alertas derivadas de `quote_event` |
| Compra real repetida | Las dos transacciones de octubre 26 y 27 en la tabla superior, con reintento rechazado |
| CI por cambio | PRs [#6](https://github.com/Micoh18/setareh/pull/6), [#7](https://github.com/Micoh18/setareh/pull/7), [#8](https://github.com/Micoh18/setareh/pull/8), [#9](https://github.com/Micoh18/setareh/pull/9) y [#10](https://github.com/Micoh18/setareh/pull/10), todos con CI en verde; runs [40222068704](https://github.com/Micoh18/setareh/actions/runs/40222068704), [40415893237](https://github.com/Micoh18/setareh/actions/runs/40415893237), [40422247678](https://github.com/Micoh18/setareh/actions/runs/40422247678), [40425813855](https://github.com/Micoh18/setareh/actions/runs/40425813855), [40430038845](https://github.com/Micoh18/setareh/actions/runs/40430038845) |
| Pruebas automatizadas | 67 pruebas en `backend/src/*.test.ts` (35 en la semana 1) |
| Auditoría de dependencias | `npm audit` sigue bloqueando el CI ante cualquier aviso, salvo una excepción acotada y con vencimiento (2026-11-30) para `GHSA-mrhx-c7xc-m3w5` en la copia de zod 3 que fija `@x402/core`, que no tiene versión corregida; la justificación está en `backend/scripts/audit-prod.mjs` |

Hallazgos corregidos durante la semana, todos encontrados al escribir estas
pruebas: un quote podía cobrarse dos veces ante pagos concurrentes; un pago
podía perderse si el quote vencía durante el settlement; un timeout del
facilitador se trataba como fallo definitivo; las respuestas `500` devolvían
texto interno; el estado `out_of_stock` nunca era observable; las llamadas a
Shopify no tenían plazo.

## Criterio para declarar un piloto externo

Un piloto con un comercio de un tercero se publicará como tal sólo cuando se
puedan reunir y redactar de forma segura estos elementos: confirmación escrita
del comercio, confirmación independiente del evaluador, fecha y alcance del
sprint, hash de una transacción de prueba, resultado de la orden y reporte de
incidencias. Hasta entonces, las transacciones anteriores siguen siendo
evidencia técnica interna, no una validación comercial independiente.
