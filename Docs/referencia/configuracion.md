---
title: Configuración
description: Variables de entorno y límites de una instancia de Setareh.
---

Parte desde `backend/.env.example`; nunca publiques el archivo `.env` real.

## Shopify

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | Sí | Dominio `*.myshopify.com` de la tienda del entorno (ver [Tiendas](#tiendas)). |
| `SHOPIFY_CLIENT_ID` | Sí | ID de la app de Shopify. |
| `SHOPIFY_CLIENT_SECRET` | Sí | Secreto de la app; nunca se registra ni se expone. |
| `SHOPIFY_APPS` | No | Apps de tiendas que no pueden usar la app por defecto, como JSON: `{"otra-tienda.myshopify.com": {"clientId": "…", "clientSecret": "…"}}`. Una app de distribución personalizada se instala en una sola tienda, así que cada tienda adicional puede traer la suya. |
| `SHOPIFY_API_VERSION` | No | Versión Admin API; el ejemplo define `2026-10`. |
| `SHOPIFY_CREDENTIALS_REF` | No | Etiqueta de auditoría para la fuente de credenciales. |
| `SHOPIFY_TIMEOUT_MS` | No | Plazo por llamada a la Admin API (por defecto `10000`). Las lecturas reintentan hasta dos veces ante `429`, `5xx`, timeout o `THROTTLED`; crear y completar drafts nunca se reintenta. |
| `SHOPIFY_AUTH_MODE` | No | `client_credentials` (por defecto) o `authorization_code`. Ver abajo. |
| `SETAREH_TOKEN_ENCRYPTION_KEY` | Para OAuth | 32 bytes aleatorios en base64; cifra con AES-256-GCM los tokens que Shopify entrega al instalar. |

### Modos de autenticación con Shopify

- `client_credentials` pide un token con el client ID y el secreto de la app.
  Shopify sólo lo permite cuando la app y la tienda pertenecen a la misma
  organización, por lo que sirve para la tienda propia de referencia.
- `authorization_code` usa el token que Shopify entrega cuando la tienda
  instala la app. Es el modo para tiendas de terceros: la tienda aprueba los
  permisos en Shopify y no comparte credenciales.

Las rutas de instalación se activan cuando existen `SHOPIFY_CLIENT_ID`,
`SHOPIFY_CLIENT_SECRET`, `SETAREH_TOKEN_ENCRYPTION_KEY` y `SETAREH_BASE_URL`,
aunque el modo siga en `client_credentials`. Así se puede instalar primero y
cambiar de modo después. Setareh solicita tokens offline que expiran: renueva
el token de acceso antes de su vencimiento y guarda el refresh token rotado.
Si el refresh token vence, la tienda debe volver a abrir la instalación.

En la configuración de la app en el Dev Dashboard de Shopify:

| Campo | Valor |
| --- | --- |
| App URL | `SETAREH_BASE_URL/shopify/install` |
| Allowed redirection URL | `SETAREH_BASE_URL/shopify/oauth/callback` |
| Webhook `app/uninstalled` | Lo registra Setareh por API al completar cada instalación; para la tienda propia, `npm run webhooks:ensure`. |

## Tiendas

Una instancia atiende varias tiendas. Cada una tiene un identificador
(`merchantId`), que es la parte de su dominio Shopify anterior a
`.myshopify.com`, y lleva sus propios datos: dirección Stellar que recibe sus
pagos, tope por orden, tope por día y estado.

Hay dos maneras de registrar una tienda:

- **Tienda del entorno.** La que nombra `SHOPIFY_STORE_DOMAIN`. Su dirección y
  sus topes salen de `STELLAR_MERCHANT_ADDRESS`, `SETAREH_MAX_QUOTE_USDC` y
  `SETAREH_MAX_DAY_USDC`.
- **Tiendas que instalan por OAuth.** Al aprobar la app en Shopify, la persona
  dueña llega a una página de configuración donde escribe su dirección Stellar
  y sus topes (ver [Conectar un comercio](/comercios/shopify/)). Nadie del
  equipo de Setareh los escribe, y el entorno no los sobrescribe después.

`npm run merchant -- list` muestra las tiendas registradas; `limits`, `disable`
y `enable` cambian topes o pausan una tienda. La dirección de cobro no se puede
cambiar desde ese comando.

## Agentes

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `SETAREH_AGENT_AUTH` | No | `required` (por defecto): toda ruta `/v1` exige una clave de agente. `off` sirve la API sin claves y es sólo para desarrollo local. |
| `SETAREH_AUTH_FAILURES_PER_HOUR` | No | Intentos sin clave válida que se toleran por dirección y hora antes de responder `429`; por defecto `30`. |

Una clave de agente identifica a un agente comprador y lo liga a una tienda.
La emite quien opera Setareh:

```powershell
npm.cmd run agent-key -- create --merchant <merchantId> --label "<quién la tiene>"
npm.cmd run agent-key -- list
npm.cmd run agent-key -- revoke <id o prefijo>
```

La clave se muestra una sola vez y se guarda como hash SHA-256: una copia de
la base de datos no permite usarla. No tiene relación con la wallet: abre la
API, no firma pagos.

## Setareh y quotes

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `SETAREH_DATABASE_PATH` | No | Ruta SQLite local; por defecto `setareh.db`. |
| `SETAREH_BASE_URL` | Recomendada | URL absoluta que recibe la wallet para pagar el endpoint x402. |
| `SETAREH_HTTP_HOST` | No | Usa `127.0.0.1` localmente; no expongas `0.0.0.0` sin proxy HTTPS. |
| `SETAREH_MERCHANT_NAME` | No | Nombre visible de la tienda del entorno. |
| `SETAREH_USDC_PER_CLP` | Sí | Tasa fija de demo usada para convertir el total Shopify a USDC. |
| `SETAREH_FX_SOURCE` | No | Etiqueta de auditoría de la tasa configurada. |
| `SETAREH_FLAT_SHIPPING_CLP` | No | Costo fijo de despacho incorporado al draft. |
| `SETAREH_SHIPPING_TITLE` | No | Nombre del despacho en Shopify. |
| `SETAREH_MAX_QUOTE_USDC` | No | Tope por orden de la tienda del entorno; por defecto `30`. |
| `SETAREH_MAX_DAY_USDC` | No | Tope por día (UTC) de la tienda del entorno; por defecto, cinco veces el tope por orden. |
| `QUOTE_TTL_MINUTES` | No | Vida del quote; por defecto `10` minutos. |
| `SETAREH_QUOTES_PER_CLIENT_PER_HOUR` | No | Máximo de `POST /v1/quotes` por clave de agente y hora; por defecto `10`. |
| `SETAREH_QUOTES_PER_HOUR` | No | Máximo de `POST /v1/quotes` por tienda y hora; por defecto `60`. Cada quote crea un draft real en Shopify. |

Los límites se guardan en la base de datos: un reinicio del servicio no los
pone en cero.

El tope por día cuenta, desde las 00:00 UTC, lo ya pagado o en curso más los
quotes vigentes sin pagar. Un quote que lo superaría se rechaza con `402`
antes de crear nada en Shopify.

La tasa y el total USDC se congelan dentro de cada quote. Si cambian artículos,
cantidad, dirección, despacho o presupuesto, descarta el quote y crea otro.

## Stellar y x402

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `STELLAR_NETWORK` | Sí | Debe ser `stellar:testnet` en este MVP. |
| `STELLAR_PAYMENT_ASSET` | Sí | Debe ser `USDC`. |
| `STELLAR_MERCHANT_ADDRESS` | Sí | Dirección pública Stellar receptora de la tienda del entorno; Setareh valida su formato. |
| `X402_FACILITATOR_URL` | No | URL del facilitador; por defecto `https://x402.org/facilitator`. |
| `STELLAR_RPC_URL` | No | RPC Soroban que usa `reconcile:payment`; por defecto el RPC público de testnet. |
| `PORT` | No | Puerto de la superficie HTTP, normalmente `4020`. |
| `SETAREH_TRANSPORT` | No | `stdio` para MCP local, `http` para un contenedor desplegado o `both` para desarrollo. Sin valor, infiere `stdio` sin `PORT` y `both` con `PORT`. |

## Contenedor HTTP

El repositorio incluye `backend/Dockerfile` para ejecutar la API HTTP sin
exponer el transporte MCP por stdio. Construye y arranca una instancia local
así:

```powershell
docker build -t setareh-backend ./backend
docker volume create setareh-data
docker run --rm --name setareh-api -p 4020:4020 `
  --env-file backend/.env `
  -e SETAREH_TRANSPORT=http `
  -e SETAREH_HTTP_HOST=0.0.0.0 `
  -e SETAREH_DATABASE_PATH=/data/setareh.db `
  -v setareh-data:/data setareh-backend
```

El volumen conserva los quotes y estados de conciliación. En un despliegue,
termina HTTPS antes del contenedor, configura `SETAREH_BASE_URL` con la URL
HTTPS pública y conserva `.env` y el volumen fuera de Git. No expongas el
puerto directamente a Internet ni pongas claves privadas de wallets en el
servidor.

## Wallet del agente

`backend/agent.env` es local al runtime que firma pagos:

| Variable | Propósito |
| --- | --- |
| `SETAREH_API_URL` | Base URL HTTP que llamará el cliente de demo. |
| `SETAREH_AGENT_KEY` | Clave de agente que entrega el equipo de Setareh; identifica al agente ante la API y define en qué tienda compra. No es la clave de la wallet. |
| `AGENT_STELLAR_PRIVATE_KEY` | Clave privada testnet; jamás llega a Setareh. |
| `AGENT_MAX_USDC` | Límite local que la wallet permite gastar. |

El cliente de referencia rechaza una red, activo o importe que no cumpla estas
restricciones antes de firmar. Mantén `AGENT_MAX_USDC` igual o por debajo del
tope por orden de la tienda. Son dos topes distintos: el de la tienda limita
cuánto puede recibir; `AGENT_MAX_USDC` limita cuánto gasta este agente.
