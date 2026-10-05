---
title: API HTTP y x402
description: Endpoints HTTP del MVP y el ciclo de pago protegido con x402.
---

Con `PORT=4020`, Setareh expone estos endpoints HTTP:

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/health` | Comprobación de vida y red configurada. |
| `GET` | `/v1/merchants/:merchantId` | Metadatos públicos del comercio habilitado. |
| `GET` | `/v1/catalog?query=&limit=` | Catálogo de variantes activas. |
| `GET` | `/v1/availability/:variantId?quantity=` | Stock reconsultado de una variante. |
| `POST` | `/v1/quotes` | Crear quote confirmado. |
| `POST` | `/v1/quotes/:quoteId/pay-and-place` | Pagar con x402 y crear una orden. |
| `GET` | `/v1/orders/:orderId` | Estado de quote u orden. |

## Crear un quote

El cuerpo de `POST /v1/quotes` corresponde al de `create_quote` en MCP. Los
IDs de variante deben tener forma `gid://shopify/ProductVariant/...`, las
cantidades están entre 1 y 20, y `userConfirmed` debe ser `true`.

El backend crea un draft en Shopify y responde `201` con un `quoteId`, totales,
vencimiento y requisitos del pago. Trátalo como un valor sensible operativo:
no lo publiques con datos de dirección o correo.

## Pagar `pay-and-place`

Primero, la wallet envía una petición sin prueba de pago:

```http
POST /v1/quotes/<quoteId>/pay-and-place
Content-Type: application/json

{"userConfirmed":true}
```

Setareh responde `402 Payment Required` con requisitos de x402. La wallet debe
leerlos antes de firmar y verificar como mínimo:

- red `stellar:testnet`;
- activo USDC testnet correcto;
- destinatario igual al del quote;
- importe exacto y dentro de su límite local;
- quote aún vigente.

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
| `404` | Merchant, quote, variante u orden no existe. |
| `409` | Quote vencido, no pagable, sobre límite o stock no disponible. |
| `500` | Error inesperado; no reintentes un pago a ciegas. Consulta estado y concilia. |

## Exposición pública

Esta API pertenece al MVP y no implementa autenticación ni rate limiting de
producción. Déjala en loopback durante desarrollo. Antes de exponerla detrás
de `api.setareh.site`, agrega HTTPS, autenticación, límites de tasa, registros,
protección de datos y una revisión de seguridad.
