---
title: Reproducir el piloto
description: Guía para que una persona evaluadora repita una compra de punta a punta en testnet y un reintento controlado, con su propia wallet.
---

## Qué vas a comprobar

Que un agente puede pagar un quote de Setareh con USDC en `stellar:testnet` y
obtener una orden Shopify real, y que repetir el pago del mismo quote no cobra
ni crea una orden por segunda vez. Todo ocurre en testnet: no hay dinero real,
no hay despacho físico y Setareh nunca recibe tu clave privada.

Tiempo estimado: 30 minutos la primera vez, incluido el fondeo de la wallet.

## Requisitos

- Node.js 24 o superior y Git.
- Una terminal con `curl`. En Windows funciona PowerShell o Git Bash.
- Una cuenta Stellar **testnet** nueva, creada por ti, con:
  - XLM de testnet para comisiones (Friendbot);
  - una trustline al USDC de testnet y saldo suficiente para el producto de
    prueba (faucet de Circle).

Crea la cuenta con [Stellar Lab](https://lab.stellar.org/account/create)
en red testnet y pulsa "Fund account with Friendbot". Luego pide USDC de
testnet en el [faucet de Circle](https://faucet.circle.com/) eligiendo Stellar
testnet; el faucet crea la trustline si no existe. Guarda la clave secreta
(`S...`) sólo en tu máquina.

## 1. Clonar e instalar

```bash
git clone https://github.com/Micoh18/setareh.git
cd setareh/backend
npm ci
```

Anota el commit que estás usando; irá en tu reporte:

```bash
git rev-parse --short HEAD
```

## 2. Configurar la wallet local

Crea `backend/agent.env` con tres líneas. La clave secreta se queda en ese
archivo y nunca viaja al servidor:

```ini
SETAREH_API_URL=https://api.setareh.site
AGENT_MAX_USDC=5
AGENT_STELLAR_PRIVATE_KEY=<tu clave secreta S..., solo en este archivo>
```

`AGENT_MAX_USDC` es tu tope local por pago. El cliente de referencia rechaza
cualquier desafío por encima de ese valor antes de firmar.

## 3. Elegir el producto de prueba

Consulta el catálogo del comercio piloto y localiza el producto reservado para
la evaluación (su nombre te lo confirma Setareh por el canal privado junto con
la ventana de prueba):

```bash
curl -s "https://api.setareh.site/v1/catalog?merchantId=micohstore&query=evaluador"
```

Copia el `variant.id` (forma `gid://shopify/ProductVariant/...`) y comprueba
que `availability.canPurchase` sea `true`.

## 4. Crear el quote

Usa un correo y una dirección ficticios pero con forma válida. El quote crea un
draft real en Shopify y vence a los 10 minutos, así que haz este paso justo
antes de pagar. Elige un `X-Request-Id` propio: Setareh lo devuelve y sirve
para correlacionar sus logs con tu reporte.

```bash
curl -s -X POST https://api.setareh.site/v1/quotes \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: eval-$(date +%s)" \
  -d '{
    "merchantId": "micohstore",
    "items": [{ "variantId": "gid://shopify/ProductVariant/REEMPLAZA", "quantity": 1 }],
    "email": "evaluacion@example.com",
    "shippingAddress": {
      "firstName": "Prueba", "lastName": "Setareh",
      "address1": "Calle de prueba 123", "city": "Santiago",
      "country": "CL", "zip": "8320000"
    },
    "userConfirmed": true
  }'
```

La respuesta `201` incluye `quoteId`, el total en moneda de la tienda, el monto
en USDC y el vencimiento. Guarda el `quoteId`.

## 5. Pagar y crear la orden

```bash
npm run demo:pay -- <quoteId>
```

El cliente hace primero una petición sin pago, recibe el desafío `402`,
verifica red, activo, destinatario y tu tope local, y sólo entonces firma el
pago y reintenta. El resultado esperado es un JSON con `"status": "created"`,
un `shopifyOrder.name` (por ejemplo `#1005`) y `payment.transactionHash`.

Verifica el hash en Horizon, que es público:

```bash
curl -s https://horizon-testnet.stellar.org/transactions/<transactionHash> | grep -E '"successful"|"ledger"|"created_at"'
```

Debe mostrar `"successful": true`.

## 6. Reintento controlado

Vuelve a ejecutar exactamente el mismo comando con el mismo `quoteId`:

```bash
npm run demo:pay -- <quoteId>
```

El resultado esperado es un rechazo **antes** de firmar nada:

```text
Expected 402 before payment, received 409: {"error":{"code":"request_rejected","message":"Quote is not payable in status created."}}
```

Comprueba que no hubo segundo cobro ni segunda orden:

```bash
curl -s https://api.setareh.site/v1/orders/<quoteId>
```

El estado sigue siendo `created`, con el mismo `transactionHash` y la misma
orden. Tu saldo de USDC en Horizon debe haber bajado una sola vez.

## 7. Qué guardar como evidencia

- Commit usado (`git rev-parse --short HEAD`).
- `quoteId` y el `X-Request-Id` que enviaste.
- Salida completa de los dos `demo:pay` (el éxito y el `409`).
- `transactionHash`, ledger y `created_at` de Horizon.
- Respuesta final de `/v1/orders/<quoteId>`.
- Cualquier cosa que no haya salido como describe esta página.

No guardes ni envíes tu clave secreta, el contenido de `agent.env` ni el
payload de pago firmado. El `transactionHash` es público y puede publicarse.

## Si algo falla

| Síntoma | Qué significa | Qué hacer |
| --- | --- | --- |
| `429` al crear el quote | Límite de 10 quotes por cliente y hora | Espera el `Retry-After` |
| `resulting balance is not within the allowed range` | La wallet no tiene USDC suficiente o falta la trustline | Vuelve al faucet; no se firmó ningún pago |
| `Quote exceeds the local ... spending limit` | El producto cuesta más que `AGENT_MAX_USDC` | Sube el tope sólo si el precio es el acordado |
| `409` con `Quote expired` | Pasaron más de 10 minutos desde el quote | Crea un quote nuevo (es un pedido nuevo, no un reintento) |
| Timeout o error `5xx` durante el pago | El cobro pudo o no haber ocurrido | **No crees otro quote.** Consulta `/v1/orders/<quoteId>`; si ves `payment_unknown` o `manual_review`, repórtalo tal cual |

Un fallo es un hallazgo válido del reporte, no un motivo para repetir hasta que
salga bien. Los estados y su recuperación están en
[Estados y recuperación](/operaciones/estados-y-recuperacion/).
