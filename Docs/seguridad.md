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
  Detalle y retención en [Logs y retención](/operaciones/logs-y-retencion/).
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

Revisado el 2026-11-08 con lo observado en el piloto (semanas 1 a 3 de la
[evidencia](/evidencia/)). Cada control está cubierto por una prueba
automática o por un incidente real documentado.

| Amenaza | Control actual | Riesgo que permanece |
| --- | --- | --- |
| Agente intenta pagar más, con otro activo/red/destino o tras expirar el quote | El backend compara red, activo, destinatario, monto y vencimiento contra el quote congelado; tope por quote en el servidor; límite local en el cliente. | Los límites del lado agente los configura quien lo opera; el servidor sigue rechazando montos distintos al quote. |
| Reintento concurrente crea dos órdenes o dos cargos | Una fila de pago y una orden por quote; reclamación atómica del settlement y de la creación de orden; `409` para un quote ya pagado. | Casos de infraestructura no probados pasan a conciliación, no se asumen como éxito. |
| El facilitador no responde o responde `504` **después de haber enviado la transacción** | El quote queda en `payment_unknown`, bloqueado para nuevos pagos; `reconcile:payment` lo resuelve contra la red (con `--tx` si el RPC ya no tiene el historial) y sólo lo declara impago cuando la autorización firmada expiró. Ocurrió el 2026-11-05 y se resolvió así. | Requiere operador: no hay autoconciliación programada. El facilitador público no tiene SLA. |
| Facilitador o RPC suplantados afirman un settlement que no ocurrió | El backend valida que el settlement coincida con el quote; la URL del facilitador es configuración del servidor, no del cliente; `reconcile:payment` consulta la red por hash. | No se verifica el hash en la red **antes** de crear la orden; se confía en la respuesta del facilitador configurado. |
| Shopify no responde o limita las llamadas | Cada llamada tiene un plazo; las lecturas reintentan con backoff acotado y `Retry-After`; crear y completar drafts no se reintenta nunca. | Un timeout al completar el draft deja el quote en `manual_review` hasta conciliar con `reconcile:order`. |
| Shopify falla después de un settlement válido | Se conserva evidencia y el estado pasa a `manual_review`; el runbook impide reintentar el pago a ciegas. | No hay reembolso automático. |
| Se filtran claves, datos personales o receipts | Lista permitida y filtros en los logs; respuestas `500` genéricas; `get_order_status` entrega un resumen; CI revisa los docs; [política de logs y retención](/operaciones/logs-y-retencion/). | Datos personales de quotes sin purga automática; snapshots del proveedor contienen la base; sin gestor de secretos ni DLP. |
| Instalación OAuth falsificada, repetida o con permisos insuficientes | El callback exige firma HMAC de Shopify, dominio `*.myshopify.com` anclado al configurado y un `state` de un solo uso que vence en 10 minutos; se verifican los scopes concedidos; los tokens se guardan cifrados. | Quien controle el entorno del servidor puede descifrar los tokens. |
| Suplantación ante la persona dueña: alguien le envía un enlace de otra app haciéndose pasar por Setareh | El enlace legítimo lleva a la pantalla de permisos de Shopify con la app registrada y los scopes publicados; la [guía](/comercios/shopify/) dice qué no se pide nunca. | Setareh no puede impedir que la dueña apruebe otra app; el control es la guía y el canal privado. |
| Desinstalación no propagada | El webhook `app/uninstalled` firmado borra los tokens; Shopify ya los revocó, así que cualquier llamada falla igual. | Si la suscripción al webhook se pierde, el registro local queda activo con tokens inútiles hasta que una llamada falle o un operador lo revoque. |
| Endpoint público recibe abuso (drafts reales, stock agotado) | La creación de quotes está limitada por cliente y en total por hora (`429` con `Retry-After`); el despliegue termina HTTPS. | Límite en memoria de una sola instancia; sin autenticación de agentes, WAF ni control por comercio. |
| El agente altera datos de la persona compradora sin avisar | Las instrucciones del MCP comprador exigen mostrar el quote completo antes de pedir confirmación y avisar de cualquier corrección. | Depende del modelo que ejecute el agente; no hay validación estructural de que lo mostrado sea lo enviado. |
| La red cambia de protocolo y el cliente o el servidor dejan de decodificar | SDK de Stellar fijado en una versión mínima y requisito en la guía; ocurrió con el Protocolo 30 el 2026-11-05. | El preflight consulta JSON, no XDR: la incompatibilidad se detecta en el primer pago. |
| Dependencias vulnerables en producción | La CI falla ante cualquier aviso de `npm audit` no aceptado; las excepciones llevan paquete, ruta y fecha de vencimiento. Desde el 2026-11-07 no hay excepciones activas. | El árbol incluye dos copias del SDK de Stellar (la principal y una anidada en la librería x402), que hay que vigilar en cada cambio de protocolo. |

## Secretos: qué existe y quién lo custodia

| Secreto | Custodio | Dónde vive | Si se expone |
| --- | --- | --- | --- |
| Secreto de la app Shopify (`SHOPIFY_CLIENT_SECRET`) | Operador de Setareh | Gestor de secretos del despliegue; nunca en Git. | Se regenera en Shopify y se redespliega; las instalaciones existentes siguen válidas. |
| Clave de cifrado de tokens (`SETAREH_TOKEN_ENCRYPTION_KEY`) | Operador de Setareh | Gestor de secretos del despliegue. | Se rota y las tiendas reinstalan; sin la base de datos la clave sola no sirve. |
| Tokens OAuth de cada tienda | Setareh, derivados de la aprobación de la dueña | Base de datos, cifrados; duran 1 hora y se renuevan solos. | La dueña desinstala desde Shopify y quedan revocados. |
| Clave de la wallet compradora (`AGENT_STELLAR_PRIVATE_KEY`) | Quien opera el agente | `agent.env` en la máquina del agente; nunca llega al servidor. | Se vacía la wallet a una nueva. |
| Clave de la wallet receptora del comercio | Comercio | Fuera de Setareh; Setareh sólo conoce la dirección pública. | Fuera de Setareh. |

Configuración sensible que no es secreta pero cambia el comportamiento
(dirección receptora, tasa, tope por quote, dominio de tienda, URL del
facilitador) vive en la configuración del despliegue, se refleja en la salida
de `doctor` y queda congelada en cada quote.

Lo que Setareh no tiene ni pide: contraseña, MFA ni códigos de recuperación de
la tienda; tokens entregados por chat o correo; claves de ninguna wallet;
datos de clientes de la tienda más allá de la dirección y el correo que la
persona compradora entrega para su propia orden.

## Riesgos abiertos (2026-11-08)

1. Facilitador x402 público sin SLA que puede liquidar y responder `504`.
2. Sin autoconciliación programada de `payment_unknown`; requiere operador.
3. Datos personales de quotes sin purga automática; política declarada,
   implementación pendiente.
4. Sin gestor de secretos ni rotación automatizada; la clave de cifrado vive
   en el entorno del servidor.
5. Rate limit en memoria y sin autenticación de agentes; no apto para
   exposición productiva.
6. Preflight ciego a cambios de XDR; se detectan en el primer pago.
7. Dos copias del SDK de Stellar en el árbol de dependencias.
8. Instalar el entorno del agente sigue costando unos 45 minutos a una persona
   no técnica. No es un riesgo de seguridad, pero sí de adopción.

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
