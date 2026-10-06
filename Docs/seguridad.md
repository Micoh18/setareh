---
title: Seguridad, límites y modelo de amenazas
description: Controles implementados, límites del MVP, amenazas tratadas y riesgos que siguen abiertos.
---

## Controles implementados

- La clave privada de la wallet compradora permanece en el runtime del agente.
- La configuración acepta sólo `stellar:testnet` y `USDC` para el MVP.
- Un quote congela importe Shopify, importe USDC, tasa, destinatario y
  vencimiento.
- Antes de completar Shopify, el backend compara los requisitos liquidados con
  red, activo, destinatario y monto exactos del quote.
- Un quote tiene una fila de pago y una orden; la creación de orden se reclama
  atómicamente para evitar duplicados ante reintentos.
- La evidencia persistida expone un resumen y hash de transacción, no el
  receipt crudo del facilitador a través de `get_order_status`.

## Modelo de amenazas del MVP

### Activos y límites de confianza

| Activo o decisión | Quién lo controla | Límite que Setareh debe respetar |
| --- | --- | --- |
| Clave y política de gasto de la wallet | Persona/agente | La clave no llega al backend; la wallet decide si firma. |
| Catálogo, stock, precio y fulfillment | Comercio/Shopify | Shopify sigue siendo la fuente de verdad hasta crear la orden. |
| Quote, estado de pago e idempotencia | Setareh | Se persisten para impedir que un reintento cree dos órdenes. |
| Autorización/settlement x402 | Wallet y facilitador | Setareh verifica requisitos del pago antes de crear la orden. |
| Secretos Shopify y operación | Comercio/operador | Nunca se publican en docs, logs ni respuestas MCP. |

### Amenazas, controles y riesgo residual

| Amenaza | Control actual | Riesgo que permanece |
| --- | --- | --- |
| Agente intenta pagar más, con otro activo/red/destino o tras expirar el quote | El backend compara red, activo, destinatario, monto y vencimiento contra el quote; la wallet tiene límites locales. | La configuración de límites y la wallet siguen siendo responsabilidad del operador/agente. |
| Reintento concurrente crea dos órdenes o dos cargos | Una fila de pago/orden por quote y reclamación atómica de creación de orden. | Casos de infraestructura no probados deben pasar a conciliación, no asumirse como éxito. |
| Shopify falla después de un settlement válido | Se conserva evidencia y el estado pasa a `manual_review`; el runbook impide reintentar el pago a ciegas. | No hay reembolso automático ni resolución comercial automatizada. |
| Facilitador o respuesta x402 no coincide con el quote | Se valida el requisito de pago y su settlement antes de completar Shopify. | El facilitador sigue siendo una dependencia externa que debe evaluarse para producción. |
| Se filtran claves, PII o receipts | `.env` está ignorado, `get_order_status` entrega un resumen y los docs prohíben publicar datos sensibles. | No hay gestor centralizado de secretos, DLP ni auditoría externa en el MVP. |
| Endpoint público recibe abuso o tráfico no autorizado | No se debe exponer el servidor local; producción requeriría HTTPS, control de acceso y rate limiting. | Esos controles aún no están implementados como servicio público. |

## Datos que nunca deben aparecer en este sitio

- `SHOPIFY_CLIENT_SECRET`, tokens de acceso o archivos `.env` reales.
- `AGENT_STELLAR_PRIVATE_KEY` o cualquier seed de wallet.
- Correos, direcciones, IDs de pedidos de clientes o receipts completos.
- Logs sin depuración ni valores de configuración que permitan reproducir un
  entorno privado.

Usa `.private-docs/` para notas internas; Git lo ignora. El portal público se
genera únicamente desde `Docs/`.

## Límites del MVP

Setareh no es todavía un servicio de producción. No incluye autenticación,
autorización multi-tenant, rate limiting, gestión de secretos, webhooks de
Shopify, monitoreo centralizado, reembolsos automáticos, soporte mainnet ni
políticas avanzadas por colección o zona.

No publiques el HTTP local directamente. Una exposición productiva requiere,
como mínimo, HTTPS, control de acceso, WAF/rate limiting, almacenamiento de
secretos, cifrado apropiado, auditoría, backups, alertas y una revisión
independiente de seguridad.

## Ante un evento irregular

Si un pago aparece liquidado pero la orden no está `created`, no repitas el
pago. Conserva el `quoteId`, consulta estado y sigue el proceso de
[recuperación](/operaciones/estados-y-recuperacion/). Si hay sospecha de
exposición de una clave, revócala o reemplázala en el proveedor correspondiente
y documenta el incidente sólo en canales privados.
