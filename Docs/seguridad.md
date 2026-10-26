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
- Los logs son JSON estructurado y redactado: sólo se escriben campos
  operativos de una lista permitida (`quoteId`, estado, ruta, latencia, hash
  Stellar) y todo texto se filtra contra emails, seeds Stellar, tokens Shopify,
  credenciales y blobs codificados como pagos firmados. Las variables de las
  llamadas a Shopify y los argumentos de las tools MCP nunca se registran.
- Cada request HTTP y cada tool MCP lleva un `correlationId` (el `X-Request-Id`
  del cliente si es un token opaco, o un UUID generado) que se devuelve en la
  respuesta y acompaña cada línea de log y cada cambio de estado del quote,
  auditado en la tabla `quote_event`.
- Las respuestas `500` no devuelven el texto interno del error, que puede
  provenir de Shopify o del facilitador; el detalle queda sólo en el log
  redactado bajo el `correlationId`.
- El CI revisa `Docs/` contra patrones conocidos de tokens Shopify, seeds Stellar
  y asignaciones de secretos antes de compilar el portal. Es una barrera contra
  errores comunes, no un sustituto de la revisión humana o de un gestor de
  secretos.

## Modelo de amenazas del MVP

### Activos y límites de confianza

| Activo o decisión | Quién lo controla | Límite que Setareh debe respetar |
| --- | --- | --- |
| Clave y política de gasto de la wallet | Persona/agente | La clave no llega al backend; la wallet decide si firma. |
| Catálogo, stock, precio y fulfillment | Comercio/Shopify | Shopify sigue siendo la fuente de verdad hasta crear la orden. |
| Quote, estado de pago e idempotencia | Setareh | Se persisten para impedir que un reintento cree dos órdenes. |
| Autorización/settlement x402 | Wallet y facilitador | Setareh verifica requisitos del pago antes de crear la orden. |
| Secretos Shopify y operación | Comercio/operador | Nunca se publican en docs, logs ni respuestas MCP. |
| Tokens OAuth de cada tienda | Setareh | Se guardan cifrados con AES-256-GCM ligados a la tienda y se borran al desinstalar. |

### Amenazas, controles y riesgo residual

| Amenaza | Control actual | Riesgo que permanece |
| --- | --- | --- |
| Agente intenta pagar más, con otro activo/red/destino o tras expirar el quote | El backend compara red, activo, destinatario, monto y vencimiento contra el quote; la wallet tiene límites locales. | La configuración de límites y la wallet siguen siendo responsabilidad del operador/agente. |
| Reintento concurrente crea dos órdenes o dos cargos | Una fila de pago/orden por quote; reclamación atómica del settlement (un solo pago llega al facilitador) y de la creación de orden. | Casos de infraestructura no probados deben pasar a conciliación, no asumirse como éxito. |
| El facilitador no responde o responde de forma ambigua tras enviar la transacción | El quote queda en `payment_unknown`, bloqueado para nuevos pagos; `reconcile:payment` lo resuelve contra la red y sólo lo declara impago cuando la autorización firmada expiró. No se guarda el payload firmado. | Fuera de la retención del RPC (~7 días en testnet) la conciliación requiere un hash aportado por el operador. |
| Shopify no responde o limita las llamadas | Cada llamada tiene un plazo; las lecturas reintentan con backoff acotado y `Retry-After`; crear y completar drafts no se reintenta nunca, porque una respuesta perdida puede haber creado la orden. | Un timeout al completar el draft deja el quote en `manual_review` hasta conciliar con `reconcile:order`. |
| Shopify falla después de un settlement válido | Se conserva evidencia y el estado pasa a `manual_review`; el runbook impide reintentar el pago a ciegas. | No hay reembolso automático ni resolución comercial automatizada. |
| Facilitador o respuesta x402 no coincide con el quote | Se valida el requisito de pago y su settlement antes de completar Shopify. | El facilitador sigue siendo una dependencia externa que debe evaluarse para producción. |
| Se filtran claves, PII o receipts | `.env` está ignorado, `get_order_status` entrega un resumen, los logs se redactan con lista permitida y filtros, las respuestas `500` son genéricas y los docs prohíben publicar datos sensibles. | No hay gestor centralizado de secretos, DLP ni auditoría externa en el MVP; la retención de logs depende del proveedor. |
| Instalación OAuth falsificada o repetida | El callback exige firma HMAC de Shopify, dominio `*.myshopify.com` anclado y un `state` de un solo uso que vence en 10 minutos; el webhook de desinstalación exige firma sobre el cuerpo crudo. | La clave de cifrado vive en el entorno del servidor; quien controle ese entorno puede descifrar los tokens. |
| Endpoint público recibe abuso o tráfico no autorizado | La creación de quotes, que genera drafts reales en Shopify, está limitada por cliente y en total por hora (`429` con `Retry-After`); el despliegue termina HTTPS. | El límite vive en memoria de una sola instancia; no hay autenticación de agentes, WAF ni control de acceso por comercio. |

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
autorización multi-tenant, rate limiting más allá de la creación de quotes, gestión de secretos, webhooks de
Shopify distintos de la desinstalación, monitoreo centralizado, reembolsos automáticos, soporte mainnet ni
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
