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
| 2026-11-05 02:18:00 | USDC testnet · 4.0000000 | [`641805…36c6eb`](https://horizon-testnet.stellar.org/transactions/6418057b75cbf85fa0058fe81a902e4cf018805958c06b128c9e1c4a9936c6eb) | 5,564,288 |
| 2026-11-06 21:07:16 | USDC testnet · 8.0000000 | [`917dbf…d007cec`](https://horizon-testnet.stellar.org/transactions/917dbf9b448f93bcfa8cd690979523731efbb4477a05f7f3bcc453163d007cec) | 5,595,119 |

Las de octubre 26 y 27 se ejecutaron contra el entorno publicado
(`api.setareh.site`) con el código de la semana 2, cada una seguida de un
reintento del mismo quote que fue rechazado con `409` sin segundo cobro ni
segunda orden; las órdenes Shopify resultantes son `#1003` y `#1004`. Las dos
de noviembre son las de la semana 3, pagadas por un agente a través del MCP
del lado comprador: la del día 5 contra el entorno publicado (orden `#1005`,
conciliada contra la red tras un `504` del facilitador) y la del día 6 contra
una instancia local conectada a la misma tienda y a la misma red (orden
`#1006`, seguida de un reintento rechazado con `409`). Todas
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
correlación y métricas. Estado al 30 de octubre de 2026:

| Evidencia | Dónde comprobarla |
| --- | --- |
| Matriz de fallos automatizada | 13 escenarios con prueba en CI (concurrencia, reintentos, facilitador caído o con timeout, quote vencido durante el pago, Shopify caído tras el pago, stock agotado, reinicio del proceso, throttling, payload alterado); resumen en [Fichas por escenario](/operaciones/estados-y-recuperacion/#fichas-por-escenario) |
| Estados recuperables | `payment_unknown` para settlements sin respuesta definitiva, con conciliación contra la red ([`reconcile:payment`](/operaciones/estados-y-recuperacion/#conciliar-un-pago-incierto-payment_unknown)); `reconcile:stuck` para procesos interrumpidos |
| Logs redactados con correlación | Cada respuesta devuelve `X-Request-Id`; los logs son JSON con lista permitida y filtros de PII, claves y pagos firmados ([Seguridad](/seguridad/)); una prueba inyecta email, dirección, teléfono y un pago firmado y verifica que nada llegue a los logs ni a una respuesta `500` |
| Métricas | [Métricas](/operaciones/metricas/): embudo quote → pago → orden, excepciones, latencias y alertas derivadas de `quote_event` |
| Compra real repetida | Las dos transacciones de octubre 26 y 27 en la tabla superior, con reintento rechazado |
| CI por cambio | PRs [#6](https://github.com/Micoh18/setareh/pull/6), [#7](https://github.com/Micoh18/setareh/pull/7), [#8](https://github.com/Micoh18/setareh/pull/8), [#9](https://github.com/Micoh18/setareh/pull/9) y [#10](https://github.com/Micoh18/setareh/pull/10), todos con CI en verde; runs [40222068704](https://github.com/Micoh18/setareh/actions/runs/40222068704), [40415893237](https://github.com/Micoh18/setareh/actions/runs/40415893237), [40422247678](https://github.com/Micoh18/setareh/actions/runs/40422247678), [40425813855](https://github.com/Micoh18/setareh/actions/runs/40425813855), [40430038845](https://github.com/Micoh18/setareh/actions/runs/40430038845) |
| Pruebas automatizadas | 67 pruebas en `backend/src/*.test.ts` (35 en la semana 1) |
| Métricas del entorno publicado | `metrics` ejecutado el 30 de octubre de 2026 sobre el entorno publicado: embudo quote → pago → orden 1/1/1 desde que existe `quote_event`, 0 excepciones, latencia pago enviado → liquidado 3,5 s y liquidado → orden 2,4 s, sin alertas de quotes atascados ni en revisión |
| Documentación publicada en la semana | PRs [#11](https://github.com/Micoh18/setareh/pull/11), [#12](https://github.com/Micoh18/setareh/pull/12) y [#13](https://github.com/Micoh18/setareh/pull/13) con CI en verde; `main` cerró la semana en `f7d5bbd` ([run](https://github.com/Micoh18/setareh/actions/runs/40602795629)) |
| Demostración grabada | [Video de la semana 2](https://youtu.be/QTsrii0g9D4): una compra real en testnet con el código nuevo y el reintento rechazado |
| Auditoría de dependencias | `npm audit` sigue bloqueando el CI ante cualquier aviso, salvo una excepción acotada y con vencimiento (2026-11-30) para `GHSA-mrhx-c7xc-m3w5` en la copia de zod 3 que fija `@x402/core`, que no tiene versión corregida; la justificación está en `backend/scripts/audit-prod.mjs` |

Hallazgos corregidos durante la semana, todos encontrados al escribir estas
pruebas: un quote podía cobrarse dos veces ante pagos concurrentes; un pago
podía perderse si el quote vencía durante el settlement; un timeout del
facilitador se trataba como fallo definitivo; las respuestas `500` devolvían
texto interno; el estado `out_of_stock` nunca era observable; las llamadas a
Shopify no tenían plazo.

## Evaluadora independiente y MCP comprador

Semana 3 del sprint: kit para que una persona ajena al proyecto repita la
compra hablándole a un agente, y primera compra dirigida por esa persona.
Estado al 6 de noviembre de 2026:

| Evidencia | Dónde comprobarla |
| --- | --- |
| Guía para la persona evaluadora | [Reproducir el piloto](/agentes/reproducir-el-piloto/) (macOS) y [versión para Windows](/agentes/reproducir-el-piloto-windows/): tres programas que instalar, wallet propia en testnet y seis mensajes en español para el agente |
| MCP del lado comprador | [Servidor MCP del lado comprador](/referencia/mcp/#servidor-mcp-del-lado-comprador): el agente comprueba la wallet, busca, cotiza, paga con la wallet de quien lo usa, consulta el estado y verifica el hash en Horizon; las instrucciones del piloto van embebidas para que la persona no necesite nombrar herramientas |
| Compra de ensayo con el MCP | 5 de noviembre, contra el entorno publicado: testnet acababa de subir al Protocolo 30 y el facilitador público respondió `504` con la transacción ya enviada; el quote quedó en `payment_unknown`, se concilió contra la red con [`reconcile:payment`](/operaciones/estados-y-recuperacion/#conciliar-un-pago-incierto-payment_unknown) y salió la orden `#1005` con un solo cobro (transacción `641805…36c6eb` en la tabla superior). Dos quotes anteriores se cerraron sin cobro |
| Compra dirigida por la evaluadora | 6 de noviembre: Cristina, evaluadora independiente y sin formación técnica, dirigió la compra en la tienda Shopify de Artesmako hablándole al agente con sus propias palabras durante trece turnos, incluidas dos preguntas fuera de guion que el agente respondió sin inventar. Cotización de dos líneas, orden `#1006`, transacción `917dbf…d007cec` en la tabla superior |
| Reintento controlado | "Intentemos recomprar lo mismo" sobre el mismo quote: `409` antes de firmar, estado `created`, misma orden y mismo hash, saldo sin cambios |
| Cómo se hizo la prueba | Sesión compartida en el computador del fundador, con la wallet de pruebas del piloto; por un error puntual de configuración el agente apuntó a una instancia local conectada a la misma tienda y red, no a `api.setareh.site`. Cristina autorizó publicar su nombre, el resultado y su opinión, grabada en video el mismo día; Artesmako autorizó nombrar la tienda |
| Pruebas automatizadas | 69 pruebas en `backend/src/*.test.ts` (67 en la semana 2), incluidas dos del MCP comprador |
| CI por cambio | PRs [#14](https://github.com/Micoh18/setareh/pull/14), [#16](https://github.com/Micoh18/setareh/pull/16), [#17](https://github.com/Micoh18/setareh/pull/17), [#18](https://github.com/Micoh18/setareh/pull/18) y [#19](https://github.com/Micoh18/setareh/pull/19) con CI en verde; `main` cerró la semana en `7e2f14b` |
| Corrección desplegada | `@stellar/stellar-sdk` 17.4 y `@x402/*` 2.30 para decodificar el XDR del Protocolo 30 de testnet |

Hallazgos de la semana: un `504` del facilitador puede llegar con la
transacción ya enviada a la red, así que un `504` no significa "no se cobró";
el chequeo previo no detecta un cambio de protocolo de testnet porque sólo
consulta JSON; y la instalación previa (Node, Git, Claude Code, wallet,
faucet) sigue siendo el mayor obstáculo para una persona no técnica.

## Criterio para declarar un piloto externo

La guía [Reproducir el piloto](/agentes/reproducir-el-piloto/) (macOS; hay [versión para Windows](/agentes/reproducir-el-piloto-windows/)) describe el
procedimiento que seguirá la persona evaluadora: compra con su propia wallet
testnet y reintento controlado del mismo quote.

Un piloto con un comercio de un tercero se publicará como tal sólo cuando se
puedan reunir y redactar de forma segura estos elementos: confirmación escrita
del comercio, confirmación independiente del evaluador, fecha y alcance del
sprint, hash de una transacción de prueba, resultado de la orden y reporte de
incidencias. Hasta entonces, las transacciones anteriores siguen siendo
evidencia técnica interna, no una validación comercial independiente.

La sesión del 6 de noviembre de 2026 cumple parte de ese criterio: una persona
ajena al proyecto dirigió la compra y el reintento, con autorización suya y
del comercio para publicarlo. No cumple el resto: la wallet y el computador
eran del fundador, y la confirmación fue verbal, con un video como respaldo,
no escrita. Una repetición desde la máquina y con la wallet de la persona
evaluadora, con su confirmación por escrito, es lo que completaría el criterio.
