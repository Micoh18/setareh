---
title: Seguridad y límites
description: Controles implementados, datos sensibles y límites que no deben confundirse con garantías de producción.
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
