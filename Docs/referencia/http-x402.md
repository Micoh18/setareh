---
title: API HTTP y x402
description: Endpoints HTTP del MVP y el ciclo de pago protegido con x402.
---

Con `PORT=4020`, Setareh expone estos endpoints HTTP:

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/health` | Comprobación de vida, red configurada y si la API exige claves de agente. |
| `GET` | `/v1/merchants/:merchantId` | Nombre, estado, red y topes de la tienda de la clave. |
| `GET` | `/v1/catalog?query=&limit=` | Catálogo de variantes activas. |
| `GET` | `/v1/availability/:variantId?quantity=` | Stock reconsultado de una variante. |
| `POST` | `/v1/quotes` | Crear quote confirmado. |
| `POST` | `/v1/quotes/:quoteId/pay-and-place` | Pagar con x402 y crear una orden. |
| `GET` | `/v1/orders/:orderId` | Estado de quote u orden. |

Si la instancia tiene configurada la instalación OAuth de Shopify, expone
además estas rutas, usadas por Shopify y no por agentes:

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/shopify/install?shop=<tienda>.myshopify.com` | Inicia la autorización y redirige a Shopify. |
| `GET` | `/shopify/oauth/callback` | Recibe el código, verifica HMAC y `state`, guarda tokens cifrados, registra la tienda y redirige a su página de configuración. |
| `GET` / `POST` | `/shopify/setup?token=` | Página donde la tienda escribe su dirección Stellar y sus topes. El enlace sirve una vez y vence a los 30 minutos. |
| `POST` | `/shopify/webhooks/app-uninstalled` | Verifica la firma del webhook, borra los tokens de la tienda y la deja sin aceptar quotes nuevos. |

## Identificar al agente

Toda ruta `/v1` exige una clave de agente:

```http
Authorization: Bearer sak_<prefijo>_<secreto>
```

La clave define la tienda. `merchantId` es opcional en el cuerpo y en la
consulta; si se envía, debe ser el de la clave. Una clave ausente, mal formada
o revocada, nombrar otra tienda, o tocar un quote o una orden de otra tienda
responden `401`. Demasiados intentos sin clave válida desde una misma
dirección responden `429`.

## Crear un quote

El cuerpo de `POST /v1/quotes` corresponde al de `create_quote` en MCP. Los
IDs de variante deben tener forma `gid://shopify/ProductVariant/...`, las
cantidades están entre 1 y 20, y `userConfirmed` debe ser `true`.

Antes de crear nada en Shopify, el backend comprueba los topes de la tienda con
los precios del catálogo. Si la orden supera el tope por orden o lo que queda
del tope por día, responde `402` con `order_limit_exceeded` o
`daily_limit_exceeded` (ver [Errores esperados](#errores-esperados)).

Si cabe, crea un draft en Shopify y responde `201` con un `quoteId`, totales,
vencimiento y requisitos del pago. Trátalo como un valor sensible operativo:
no lo publiques con datos de dirección o correo.

## Pagar `pay-and-place`

Primero, la wallet envía una petición sin prueba de pago:

```http
POST /v1/quotes/<quoteId>/pay-and-place
Content-Type: application/json

{"userConfirmed":true}
```

Setareh responde `402 Payment Required` con requisitos de x402. El
destinatario (`payTo`) es la dirección de la tienda del quote. La wallet debe
leerlos antes de firmar y verificar como mínimo:

- red `stellar:testnet`;
- activo USDC testnet correcto;
- destinatario igual al del quote;
- importe exacto y dentro de su límite local;
- quote aún vigente.

### Formato de los `PaymentRequirements`

El cuerpo del `402` es `{"error":"Payment required"}`. Los requisitos viajan
en la cabecera `PAYMENT-REQUIRED`, como JSON codificado en base64url. Para un
quote de 10 USDC, decodificada:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://api.setareh.site/v1/quotes/<quoteId>/pay-and-place",
    "description": "Settle a fixed Setareh quote in USDC before creating its Shopify order.",
    "mimeType": ""
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "amount": "100000000",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "payTo": "<dirección Stellar de la tienda del quote>",
      "maxTimeoutSeconds": 60,
      "extra": { "paymentFlow": "upfront", "areFeesSponsored": true }
    }
  ]
}
```

| Campo | Valor en Setareh |
| --- | --- |
| `scheme` | Siempre `exact`: el monto no se negocia. |
| `amount` | Total del quote en unidades de 7 decimales (`100000000` = 10 USDC). |
| `asset` | Contrato del USDC de testnet (Stellar Asset Contract). |
| `payTo` | Dirección de la tienda dueña del quote. |
| `extra.paymentFlow` | `upfront`: el pago se liquida antes de crear la orden. |
| `extra.areFeesSponsored` | Lo declara el facilitador configurado; con el público, `true`. |

`accepts` trae una sola opción. El reintento lleva la prueba en la cabecera
`PAYMENT-SIGNATURE`, con el mismo objeto de `accepts` en `accepted`, y la clave
de agente en `Authorization`.

Respecto de un endpoint x402 genérico hay dos diferencias. La primera: el
recurso es un quote con vencimiento, creado antes con `POST /v1/quotes`; no
existe un precio fijo por ruta. La segunda: tras un pago liquidado, la
respuesta puede ser `202` con `pending: "verification"` mientras Stellar RPC y
Horizon confirman el hash; la orden se crea sola al confirmarse.

Tras el reintento con la prueba x402 válida, el facilitador liquida el pago. El
backend verifica que red, activo, destinatario e importe coinciden con el quote
y sólo entonces intenta completar el draft Shopify una vez.

La guía oficial de Stellar para x402 también indica inspeccionar el header
`payment-required` antes de pagar. [Pay for APIs with x402](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/pay-for-apis-x402/)

Setareh restringe el MVP al identificador canónico de USDC testnet que provee
`@x402/stellar`. El facilitador participa en el camino de pago: elegirlo es una
decisión de confianza y debe revisarse antes de cualquier uso fuera del demo.

## Errores esperados

| Código | Significado práctico |
| --- | --- |
| `400` | Cuerpo o dirección no cumple el esquema. |
| `401` | Falta la clave de agente, no es válida o fue revocada (`invalid_agent_key`), o no corresponde a esa tienda, quote u orden (`agent_key_wrong_merchant`). |
| `402` sin cabecera `PAYMENT-REQUIRED` | Tope de la tienda: `order_limit_exceeded` o `daily_limit_exceeded`. No es un desafío de pago; el cuerpo trae `limitUsdc`, `requestedUsdc` y, para el tope diario, `committedUsdc` y `resetsAt`. No se creó quote ni draft. |
| `402` con cabecera `PAYMENT-REQUIRED` | Desafío x402 de `pay-and-place`. |
| `404` | Merchant, quote, variante u orden no existe. |
| `409` | Quote vencido, ya pagado o no pagable, un pago del mismo quote en curso (`payment_in_progress`), stock no disponible, o tienda que no acepta compras (`merchant_not_enabled`). |
| `429` | Límite de quotes por clave o por tienda, o demasiados intentos sin clave válida. Trae `Retry-After`. |
| `500` | Error inesperado; no reintentes un pago a ciegas. Consulta estado y concilia. |

Un cliente x402 distingue los dos `402` por la cabecera: sólo el desafío de
pago la trae.

## Entorno de piloto publicado

Desde el 20 de octubre de 2026 la API del piloto está publicada en
`https://api.setareh.site`. Qué existe y qué no:

- HTTPS con certificado válido; HTTP redirige con `301`.
- Una sola instancia con base SQLite en volumen persistente; ver
  [despliegue y release](/operaciones/despliegue/).
- `POST /v1/quotes` está limitado a 10 por clave de agente y 60 por tienda por
  hora, porque cada quote crea un draft real en Shopify. Al superar el límite
  responde `429` con `Retry-After`.
- Los agentes se identifican con una clave ligada a una tienda. No hay WAF.
  Sigue siendo un entorno de piloto en `stellar:testnet`; no acepta dinero real.

Durante el desarrollo local, mantén la API en loopback (`127.0.0.1`).
