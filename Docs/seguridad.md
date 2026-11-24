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
- Cada agente comprador se identifica con una clave ligada a una sola tienda.
  La tienda sale de la clave, nunca de lo que envía la petición: nombrar otra
  tienda, o tocar un quote o una orden ajenos, responde `401`. Las claves se
  guardan como hash SHA-256 y no aparecen en los logs.
- Cada tienda tiene su propia dirección de cobro y sus propios topes por orden
  y por día. El desafío de pago de un quote nombra la dirección de su tienda, y
  la verificación en la red exige esa misma dirección.
- La dirección de cobro de una tienda que instala por OAuth sólo se fija o se
  cambia desde su página de configuración, a la que se llega después del
  consentimiento en Shopify, con un enlace de un solo uso.
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
| Dirección de cobro y topes de cada tienda | Comercio | Los escribe quien administra la tienda; Setareh los aplica y no los sobrescribe. |
| Claves de agente | Operador de Setareh las emite; cada agente guarda la suya | Abren la API de una tienda; no firman pagos ni dan acceso a ninguna wallet. |
| Autorización/settlement x402 | Wallet y facilitador | Setareh verifica requisitos del pago antes de crear la orden. |
| Secretos Shopify y operación | Comercio/operador | Nunca se publican en docs, logs ni respuestas MCP. |
| Tokens OAuth de cada tienda | Setareh | Se guardan cifrados con AES-256-GCM ligados a la tienda y se borran al desinstalar. |

### Amenazas, controles y riesgo residual

Revisado el 2026-11-08 con lo observado en el piloto (semanas 1 a 3 de la
[evidencia](/evidencia/)) y el 2026-11-24 al pasar a varias tiendas y agentes
identificados. Cada control está cubierto por una prueba automática o por un
incidente real documentado.

| Amenaza | Control actual | Riesgo que permanece |
| --- | --- | --- |
| Agente intenta pagar más, con otro activo/red/destino o tras expirar el quote | El backend compara red, activo, destinatario, monto y vencimiento contra el quote congelado; tope por quote en el servidor; límite local en el cliente. | Los límites del lado agente los configura quien lo opera; el servidor sigue rechazando montos distintos al quote. |
| Reintento concurrente crea dos órdenes o dos cargos | Una fila de pago y una orden por quote; reclamación atómica del settlement y de la creación de orden; `409` para un quote ya pagado. | Casos de infraestructura no probados pasan a conciliación, no se asumen como éxito. |
| El facilitador no responde o responde `504` **después de haber enviado la transacción** | El quote queda en `payment_unknown`, bloqueado para nuevos pagos. Desde el 2026-11-20 un proceso interno lo concilia contra la red cada 30 segundos sin operador: si encuentra la transferencia, la verifica en Stellar RPC y en Horizon y crea la orden; si la autorización firmada expiró sin transferencia, lo cierra como impago; si en cinco minutos no hay decisión, lo deja en `manual_review`. `reconcile:payment` sigue existiendo para el caso manual (con `--tx` si el RPC ya no tiene el historial). Ocurrió el 2026-11-05 y el 2026-11-08. | El facilitador público no tiene SLA; un pago que la red no muestra en cinco minutos termina igualmente con una persona. |
| Facilitador o RPC suplantados afirman un settlement que no ocurrió | Ninguna orden se crea por la respuesta del facilitador sola: el hash se consulta en Stellar RPC **y** en Horizon, y ambos deben mostrar una transferencia USDC del monto exacto al comercio en el mismo ledger. Un hash de otra red se rechaza en el acto; un hash con otro monto, fallido o que una de las dos fuentes contradice deja el quote en `manual_review`; un hash que ninguna fuente ve todavía espera hasta cinco minutos y después se escala. | Si RPC y Horizon fueran suplantados a la vez (o la URL de ambos en el servidor), la verificación no lo detectaría. Las URLs son configuración del servidor. |
| Shopify no responde o limita las llamadas | Cada llamada tiene un plazo; las lecturas reintentan con backoff acotado y `Retry-After`; crear y completar drafts no se reintenta nunca. | Un timeout al completar el draft deja el quote en `manual_review` hasta conciliar con `reconcile:order`. |
| Shopify falla después de un settlement válido | Se conserva evidencia y el estado pasa a `manual_review`; el runbook impide reintentar el pago a ciegas. | No hay reembolso automático. |
| Se filtran claves, datos personales o receipts | Lista permitida y filtros en los logs; respuestas `500` genéricas; `get_order_status` entrega un resumen; CI revisa los docs; [política de logs y retención](/operaciones/logs-y-retencion/). | Datos personales de quotes sin purga automática; snapshots del proveedor contienen la base; sin gestor de secretos ni DLP. |
| Instalación OAuth falsificada, repetida o con permisos insuficientes | El callback exige firma HMAC de Shopify, dominio `*.myshopify.com` anclado al configurado y un `state` de un solo uso que vence en 10 minutos; se verifican los scopes concedidos; los tokens se guardan cifrados. | Quien controle el entorno del servidor puede descifrar los tokens. |
| Suplantación ante la persona dueña: alguien le envía un enlace de otra app haciéndose pasar por Setareh | El enlace legítimo lleva a la pantalla de permisos de Shopify con la app registrada y los scopes publicados; la [guía](/comercios/shopify/) dice qué no se pide nunca. | Setareh no puede impedir que quien administra la tienda apruebe otra app; el control es la guía y el canal privado. |
| Desinstalación no propagada | El webhook `app/uninstalled` firmado borra los tokens; Shopify ya los revocó, así que cualquier llamada falla igual. | Si la suscripción al webhook se pierde, el registro local queda activo con tokens inútiles hasta que una llamada falle o un operador lo revoque. |
| Endpoint público recibe abuso (drafts reales, stock agotado) | Toda ruta de compra exige una clave de agente; la creación de quotes está limitada por clave y por tienda por hora (`429` con `Retry-After`), y el límite se guarda en la base de datos, así que un reinicio no lo pone en cero; los intentos sin clave válida se frenan por dirección; el despliegue termina HTTPS. | Una sola instancia; sin WAF. |
| Una clave de agente se filtra | Sólo abre la API de una tienda y no mueve fondos; se revoca con un comando y deja de servir en el acto; los topes de la tienda acotan lo que puede cotizar; cada quote guarda qué clave lo creó. | Hasta la revocación, quien la tenga puede crear drafts y consumir el límite de esa clave. |
| Un agente de una tienda cotiza, paga o lee en otra | La tienda se deduce de la clave; quotes y órdenes ajenos responden `401` antes de entregar un desafío de pago o llamar al facilitador. Cubierto por dos pruebas automáticas con dos tiendas. | Una ruta nueva que omita la comprobación; las actuales están cubiertas. |
| Alguien redirige los cobros de una tienda a otra cuenta | La dirección sólo se cambia en la página de configuración, tras el consentimiento en Shopify y con un enlace de un solo uso que vence en 30 minutos; la cuenta debe existir y tener trustline a USDC; el entorno del servidor no la sobrescribe; el cambio queda registrado. | Quien controle la sesión de Shopify de la tienda puede cambiarla. La página no confirma la dirección por un segundo canal. |
| La persona dueña pega su clave secreta en la página de configuración | La página sólo acepta una dirección pública válida, y ante un error no devuelve en pantalla lo que se pegó. | La clave ya salió de su computador hacia el servidor en esa petición; debe darse por expuesta y reemplazarse. |
| Una tienda vende más de lo que quiso exponer (error de precio, agente en bucle) | Topes propios por orden y por día (UTC), comprobados antes de crear nada en Shopify y otra vez con el total real; un exceso responde `402` sin requisitos de pago. | Dentro del tope, cada orden es válida; no hay reembolso automático. |
| El agente altera datos de la persona compradora sin avisar | Las instrucciones del MCP comprador exigen mostrar el quote completo antes de pedir confirmación y avisar de cualquier corrección. | Depende del modelo que ejecute el agente; no hay validación estructural de que lo mostrado sea lo enviado. |
| La red cambia de protocolo y el cliente o el servidor dejan de decodificar | SDK de Stellar fijado en una versión mínima y requisito en la guía; ocurrió con el Protocolo 30 el 2026-11-05. Desde el 2026-11-20 el arranque, `doctor -- --verify` y `/health` comparan la versión de protocolo que anuncian RPC y Horizon con la que esta versión probó (30) y avisan si la red va por delante. | El aviso no bloquea pagos: es la señal para hacer una compra de humo antes de aceptar cobros. |
| Dependencias vulnerables en producción | La CI falla ante cualquier aviso de `npm audit` no aceptado; las excepciones llevan paquete, ruta y fecha de vencimiento. Desde el 2026-11-07 no hay excepciones activas. | El árbol incluye dos copias del SDK de Stellar (la principal y una anidada en la librería x402), que hay que vigilar en cada cambio de protocolo. |

## Secretos: qué existe y quién lo custodia

| Secreto | Custodio | Dónde vive | Si se expone |
| --- | --- | --- | --- |
| Secreto de la app Shopify (`SHOPIFY_CLIENT_SECRET`) | Operador de Setareh | Gestor de secretos del despliegue; nunca en Git. | Se regenera en Shopify y se redespliega; las instalaciones existentes siguen válidas. |
| Clave de cifrado de tokens (`SETAREH_TOKEN_ENCRYPTION_KEY`) | Operador de Setareh | Gestor de secretos del despliegue. | Se rota y las tiendas reinstalan; sin la base de datos la clave sola no sirve. |
| Tokens OAuth de cada tienda | Setareh, derivados de la aprobación de quien administra la tienda | Base de datos, cifrados; duran 1 hora y se renuevan solos. | La tienda desinstala la app desde Shopify y quedan revocados. |
| Clave de agente (`SETAREH_AGENT_KEY`) | Quien opera el agente; la emite el operador de Setareh | `agent.env` en la máquina del agente; en el servidor sólo su hash. | Se revoca con un comando y se emite otra. No da acceso a fondos. |
| Clave de la wallet compradora (`AGENT_STELLAR_PRIVATE_KEY`) | Quien opera el agente | `agent.env` en la máquina del agente; nunca llega al servidor. | Se vacía la wallet a una nueva. |
| Clave de la wallet receptora del comercio | Comercio | Fuera de Setareh; Setareh sólo conoce la dirección pública. | Fuera de Setareh. |

Configuración sensible que no es secreta pero cambia el comportamiento (tasa,
dominio de la tienda del entorno, URL del facilitador) vive en la
configuración del despliegue. La dirección receptora y los topes de cada
tienda viven en la base de datos, los fija la propia tienda y `doctor` informa
si están definidos sin mostrar la dirección. Importe, tasa y destinatario
quedan congelados en cada quote.

Lo que Setareh no tiene ni pide: contraseña, MFA ni códigos de recuperación de
la tienda; tokens entregados por chat o correo; claves de ninguna wallet;
datos de clientes de la tienda más allá de la dirección y el correo que la
persona compradora entrega para su propia orden.

## Riesgos abiertos (2026-11-24)

1. Facilitador x402 público sin SLA que puede liquidar y responder `504`. La
   orden ya no depende de su respuesta (se completa por lo que dicen RPC y
   Horizon), pero sigue siendo el único camino para enviar la transacción.
2. Sin gestor de secretos ni rotación automatizada; la clave de cifrado vive
   en el entorno del servidor.
3. Dos copias del SDK de Stellar en el árbol de dependencias.
4. Instalar el entorno del agente sigue costando unos 45 minutos a una persona
   no técnica. No es un riesgo de seguridad, pero sí de adopción.
5. Si Stellar RPC y Horizon fueran suplantados a la vez, la verificación doble
   no lo detectaría; ambas URLs son configuración del servidor.
6. Las claves de agente las emite y las reparte una persona por un canal
   privado; no vencen solas ni rotan.
7. Quien controle la sesión de Shopify de una tienda puede cambiar su
   dirección de cobro; no hay confirmación por un segundo canal.

Cerrado el 2026-11-24 (entregable D2): el riesgo 3 de la lista del 2026-11-20,
"rate limit en memoria y sin autenticación de agentes". Los riesgos 4, 5 y 6
de esa lista pasan a ser los 3, 4 y 5 de esta.

Cerrados el 2026-11-20 (sprint de noviembre, entregable D1): la
autoconciliación de `payment_unknown` sin operador, la purga automática de
datos personales y el preflight de protocolo. Los riesgos 2, 4, 5 y 7 de la
lista del 2026-11-08 pasan a ser los 1, 2, 3 y 4 de esta.

## Datos que nunca deben aparecer en este sitio

- `SHOPIFY_CLIENT_SECRET`, tokens de acceso o archivos `.env` reales.
- `AGENT_STELLAR_PRIVATE_KEY` o cualquier seed de wallet.
- Correos, direcciones, IDs de pedidos de clientes o receipts completos.
- Logs sin depuración ni valores de configuración que permitan reproducir un
  entorno privado.

Usa `.private-docs/` para notas internas; Git lo ignora. El portal público se
genera únicamente desde `Docs/`.

## Límites del MVP

Setareh no es todavía un servicio de producción. Identifica a los agentes con
claves emitidas a mano y separa las tiendas por clave, pero no incluye cuentas
de usuario, autoservicio de claves, rate limiting más allá de la creación de quotes y de los intentos sin clave, gestión de secretos, webhooks de
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
