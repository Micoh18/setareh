---
title: Reproducir el piloto
description: Guía paso a paso para que una persona evaluadora repita una compra de punta a punta en testnet y un reintento controlado, desde PowerShell y con su propia wallet.
---

## Qué vas a comprobar

Que un agente puede pagar un quote de Setareh con USDC en `stellar:testnet` y
obtener una orden Shopify real, y que repetir el pago del mismo quote no cobra
ni crea una orden por segunda vez. Todo ocurre en testnet: no hay dinero real,
no hay despacho físico y Setareh nunca recibe tu clave privada.

Los comandos están escritos para **PowerShell en Windows 10 u 11**, que es la
terminal por defecto. Al final hay una nota para macOS y Linux.

Tiempo estimado: 30 minutos la primera vez, incluido el fondeo de la wallet.
La guía tiene ocho pasos; los pasos 0 a 4 se pueden hacer con calma, los pasos
5 a 7 van seguidos porque el quote vence a los 10 minutos.

## Antes de empezar: lo que te envía Setareh

Por el canal privado recibes tres datos. Sin ellos no sigas:

| Dato | Para qué |
| --- | --- |
| Día y hora de la ventana de prueba | Durante la ventana el fundador está disponible, pero no interviene |
| Nombre del producto de prueba | Lo buscas en el catálogo en el paso 4 |
| Un canal para enviar el reporte | El reporte y las capturas no se publican sin tu autorización |

## 0. Requisitos

Abre PowerShell (tecla Windows, escribe `PowerShell`, Enter) y comprueba:

```powershell
node --version
git --version
```

Necesitas **Node.js 24 o superior** y Git. Si falta alguno, instálalo desde
[nodejs.org](https://nodejs.org/) (versión LTS) y
[git-scm.com](https://git-scm.com/) y vuelve a abrir PowerShell.

En esta guía npm se invoca como `npm.cmd`. Así funciona aunque PowerShell
tenga deshabilitada la ejecución de scripts, que es lo habitual en un Windows
recién instalado.

## 1. Crear y fondear tu wallet de testnet

Necesitas una cuenta Stellar **testnet** nueva, creada por ti, con XLM para
comisiones y USDC de testnet con su trustline.

1. Entra en [Stellar Lab](https://lab.stellar.org/account/create), elige la
   red **Testnet** arriba a la derecha y pulsa **Generate keypair**. Copia la
   clave pública (`G...`) y la clave secreta (`S...`). La secreta se queda sólo
   en tu máquina; nunca la pegues en un chat ni en el reporte.
2. En la misma página pulsa **Fund account with Friendbot**. Eso crea la
   cuenta con 10 000 XLM de testnet.
3. Entra en el [faucet de Circle](https://faucet.circle.com/), elige
   **Stellar Testnet**, pega tu clave pública y pide USDC. El faucet crea la
   trustline y deposita 10 USDC de testnet. Si el faucet falla, mira la tabla
   final: Setareh puede transferirte USDC de testnet a tu cuenta pública.

## 2. Clonar e instalar

```powershell
cd ~
git clone https://github.com/Micoh18/setareh.git
cd setareh\backend
npm.cmd ci
git rev-parse --short HEAD
```

Anota la salida del último comando: es el commit que estás evaluando y va en
tu reporte. Crea también la carpeta donde guardarás la evidencia:

```powershell
New-Item -ItemType Directory -Force evidencia | Out-Null
```

## 3. Configurar la wallet local y comprobar todo

Crea `agent.env` con tres líneas. Sustituye `<tu clave secreta S...>` por tu
clave secreta, sin los signos `<` `>`, y no cambies nada más:

```powershell
@"
SETAREH_API_URL=https://api.setareh.site
AGENT_MAX_USDC=5
AGENT_STELLAR_PRIVATE_KEY=<tu clave secreta S...>
"@ | Set-Content -Path agent.env -Encoding ascii
```

`AGENT_MAX_USDC` es tu tope local por pago. El cliente de referencia rechaza
cualquier desafío por encima de ese valor antes de firmar. El producto de
prueba cuesta menos de 5 USDC.

Ahora ejecuta el chequeo previo. No firma ni paga nada: verifica Node, el
archivo, que la API responde, que tu cuenta existe en testnet, que tiene XLM
y que tiene la trustline y saldo de USDC.

```powershell
npm.cmd run --silent demo:check 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath evidencia\01-check.txt
```

El resultado esperado termina en `"ok": true`. Si algún punto sale con
`"ok": false`, el campo `detail` dice qué corregir; no pases al siguiente paso
hasta que todo esté en verde.

## 4. Elegir el producto de prueba

Busca en el catálogo del comercio piloto el producto reservado para la
evaluación. Su nombre contiene "evaluador":

```powershell
$catalogo = Invoke-RestMethod "https://api.setareh.site/v1/catalog?merchantId=micohstore&query=evaluador"
$catalogo.products | ForEach-Object { [pscustomobject]@{ titulo = $_.product.title; variantId = $_.variant.id; precio = $_.variant.price; comprable = $_.availability.canPurchase } }
```

Debe aparecer una fila con el nombre que te confirmó Setareh y `comprable`
en `True`. Guarda el `variantId` en una variable; tiene la forma
`gid://shopify/ProductVariant/...`:

```powershell
$variantId = "gid://shopify/ProductVariant/REEMPLAZA"
```

Si la lista sale vacía, el producto aún no está publicado: avísalo por el
canal privado antes de continuar.

## 5. Crear el quote

Usa un correo y una dirección ficticios pero con forma válida. El quote crea
un draft real en Shopify y **vence a los 10 minutos**, así que haz este paso
justo antes de pagar. El `X-Request-Id` es tuyo: Setareh lo devuelve y sirve
para correlacionar sus logs con tu reporte.

```powershell
$requestId = "eval-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$body = @{
  merchantId = "micohstore"
  items = @(@{ variantId = $variantId; quantity = 1 })
  email = "evaluacion@example.com"
  shippingAddress = @{
    firstName = "Prueba"; lastName = "Setareh"
    address1 = "Calle de prueba 123"; city = "Santiago"
    country = "CL"; zip = "8320000"
  }
  userConfirmed = $true
} | ConvertTo-Json -Depth 5

$quote = Invoke-RestMethod -Method Post -Uri "https://api.setareh.site/v1/quotes" -ContentType "application/json" -Headers @{ "X-Request-Id" = $requestId } -Body $body
$quote | ConvertTo-Json -Depth 5 | Tee-Object -FilePath evidencia\02-quote.json
$quoteId = $quote.quoteId
"requestId=$requestId`nquoteId=$quoteId" | Set-Content evidencia\00-ids.txt
```

La respuesta incluye `quoteId`, `shopifyDraftOrder.total` en moneda de la
tienda, `payment.amount` en USDC y `payment.expiresAt`. Comprueba que
`payment.amount` es menor que 5 y que `payment.network` es `stellar:testnet`.

## 6. Pagar y crear la orden

```powershell
npm.cmd run --silent demo:pay -- $quoteId 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath evidencia\03-pago.txt
```

El cliente hace primero una petición sin pago, recibe el desafío `402`,
verifica red, activo, destinatario y tu tope local, y sólo entonces firma el
pago y reintenta. Tarda entre 10 y 30 segundos. El resultado esperado es un
JSON con `"status": "created"`, un `shopifyOrder.name` (por ejemplo `#1005`)
y `payment.transactionHash`.

Verifica el hash en Horizon, que es público:

```powershell
$hash = (Get-Content evidencia\03-pago.txt -Raw | ConvertFrom-Json).payment.transactionHash
Invoke-RestMethod "https://horizon-testnet.stellar.org/transactions/$hash" | Select-Object successful, ledger, created_at | Tee-Object -FilePath evidencia\04-horizon.txt
```

Debe mostrar `successful` en `True`.

## 7. Reintento controlado

Vuelve a ejecutar exactamente el mismo comando con el mismo `quoteId`:

```powershell
npm.cmd run --silent demo:pay -- $quoteId 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath evidencia\05-reintento.txt
```

El resultado esperado es una sola línea de rechazo, emitida **antes** de
firmar nada:

```text
Expected 402 before payment, received 409: {"error":{"code":"request_rejected","message":"Quote is not payable in status created."}}
```

Comprueba que no hubo segundo cobro ni segunda orden:

```powershell
Invoke-RestMethod "https://api.setareh.site/v1/orders/$quoteId" | ConvertTo-Json -Depth 5 | Tee-Object -FilePath evidencia\06-orden-final.json
```

El estado sigue siendo `created`, con el mismo `transactionHash` y la misma
orden que en el paso 6. Si quieres, confirma que tu saldo de USDC bajó una
sola vez volviendo a ejecutar `npm.cmd run demo:check`.

## 8. Qué enviar como evidencia

Al terminar, la carpeta `evidencia` tiene estos archivos:

| Archivo | Contenido |
| --- | --- |
| `00-ids.txt` | Tu `X-Request-Id` y el `quoteId` |
| `01-check.txt` | Salida de `demo:check` |
| `02-quote.json` | Respuesta del quote |
| `03-pago.txt` | Salida completa del pago (éxito) |
| `04-horizon.txt` | `successful`, `ledger` y `created_at` del hash |
| `05-reintento.txt` | Salida completa del reintento (`409`) |
| `06-orden-final.json` | Respuesta final de `/v1/orders/<quoteId>` |

Envía la carpeta comprimida por el canal privado junto con el commit del paso
2 y cualquier cosa que no haya salido como describe esta página. Ninguno de
esos archivos contiene tu clave secreta. **No envíes `agent.env`.** El
`transactionHash` es público y puede publicarse.

## Si algo falla

| Síntoma | Qué significa | Qué hacer |
| --- | --- | --- |
| El faucet de Circle no entrega USDC | El faucet tiene cupo diario y a veces falla | Envía tu clave pública (`G...`) por el canal privado; Setareh te transfiere USDC de testnet y el hash de esa transferencia queda en la evidencia |
| `demo:check` dice que la cuenta no existe | Friendbot no llegó a fondearla | Repite "Fund account with Friendbot" en Stellar Lab |
| `demo:check` dice que falta la trustline | El faucet no corrió o usaste otra cuenta | Pide USDC en el faucet con la misma clave pública de `agent.env` |
| PowerShell muestra un error rojo en `Invoke-RestMethod` | La API respondió `4xx` o `5xx` | Lee el detalle con `$Error[0].ErrorDetails.Message` y guárdalo en la evidencia |
| `429` al crear el quote | Límite de 10 quotes por cliente y hora | Espera el `Retry-After` |
| `resulting balance is not within the allowed range` | La wallet no tiene USDC suficiente o falta la trustline | Vuelve al faucet; no se firmó ningún pago |
| `Quote exceeds the local ... spending limit` | El producto cuesta más que `AGENT_MAX_USDC` | Sube el tope sólo si el precio es el acordado |
| `409` con `Quote expired` | Pasaron más de 10 minutos desde el quote | Crea un quote nuevo desde el paso 5 (es un pedido nuevo, no un reintento) |
| Timeout o error `5xx` durante el pago | El cobro pudo o no haber ocurrido | **No crees otro quote.** Consulta `/v1/orders/<quoteId>`; si ves `payment_unknown` o `manual_review`, repórtalo tal cual |

Un fallo es un hallazgo válido del reporte, no un motivo para repetir hasta que
salga bien. Los estados y su recuperación están en
[Estados y recuperación](/operaciones/estados-y-recuperacion/).

## Si usas macOS o Linux

Los pasos son los mismos; cambian la sintaxis de la terminal y las rutas:

```bash
git clone https://github.com/Micoh18/setareh.git && cd setareh/backend && npm ci
mkdir -p evidencia
printf 'SETAREH_API_URL=https://api.setareh.site\nAGENT_MAX_USDC=5\nAGENT_STELLAR_PRIVATE_KEY=<tu clave secreta S...>\n' > agent.env
npm run --silent demo:check 2>&1 | tee evidencia/01-check.txt
curl -s "https://api.setareh.site/v1/catalog?merchantId=micohstore&query=evaluador"
curl -s -X POST https://api.setareh.site/v1/quotes -H "Content-Type: application/json" \
  -H "X-Request-Id: eval-$(date +%s)" -d '{ ...mismo cuerpo del paso 5... }' | tee evidencia/02-quote.json
npm run --silent demo:pay -- <quoteId> 2>&1 | tee evidencia/03-pago.txt
curl -s https://horizon-testnet.stellar.org/transactions/<transactionHash> | tee evidencia/04-horizon.txt
npm run --silent demo:pay -- <quoteId> 2>&1 | tee evidencia/05-reintento.txt
curl -s https://api.setareh.site/v1/orders/<quoteId> | tee evidencia/06-orden-final.json
```
