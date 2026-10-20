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

Ambas trazas deben mostrar `successful: true` en Horizon. Stellar testnet puede
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
| CI por cambio | [Pull request #1](https://github.com/Micoh18/setareh/pull/1); ejecuciones en verde para `400fc93` ([run](https://github.com/Micoh18/setareh/actions/runs/39361385460)), `3b8e77a` ([run](https://github.com/Micoh18/setareh/actions/runs/39361595515)), `2082d9c` ([run](https://github.com/Micoh18/setareh/actions/runs/39445624748)) y `c64e061` ([run](https://github.com/Micoh18/setareh/actions/runs/39468296438)) |
| Pruebas automatizadas | 35 pruebas en `backend/src/*.test.ts`, incluidas OAuth (firma, dominio, cifrado, replay, renovación) y límite de peticiones |
| Instalación Shopify sin compartir secretos | La tienda de referencia instaló la app por OAuth el 20 de octubre de 2026; tokens cifrados y renovación automática verificados con el preflight dentro de la instancia |

Lo que esta evidencia no demuestra: ninguna compra de un evaluador externo,
ningún uso en mainnet y ninguna garantía de disponibilidad. El proveedor de
infraestructura y sus consolas no se publican.

## Criterio para declarar un piloto externo

Un piloto con un comercio de un tercero se publicará como tal sólo cuando se
puedan reunir y redactar de forma segura estos elementos: confirmación escrita
del comercio, confirmación independiente del evaluador, fecha y alcance del
sprint, hash de una transacción de prueba, resultado de la orden y reporte de
incidencias. Hasta entonces, las transacciones anteriores siguen siendo
evidencia técnica interna, no una validación comercial independiente.
