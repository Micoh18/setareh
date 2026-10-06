---
title: Configuración
description: Variables de entorno y límites de una instancia de Setareh.
---

Parte desde `backend/.env.example`; nunca publiques el archivo `.env` real.

## Shopify

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `SHOPIFY_STORE_DOMAIN` | Sí | Dominio `*.myshopify.com` de la tienda. |
| `SHOPIFY_CLIENT_ID` | Sí | ID de la app de Shopify. |
| `SHOPIFY_CLIENT_SECRET` | Sí | Secreto de la app; nunca se registra ni se expone. |
| `SHOPIFY_API_VERSION` | No | Versión Admin API; el ejemplo define `2026-10`. |
| `SHOPIFY_CREDENTIALS_REF` | No | Etiqueta de auditoría para la fuente de credenciales. |

## Setareh y quotes

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `SETAREH_DATABASE_PATH` | No | Ruta SQLite local; por defecto `setareh.db`. |
| `SETAREH_BASE_URL` | Recomendada | URL absoluta que recibe la wallet para pagar el endpoint x402. |
| `SETAREH_HTTP_HOST` | No | Usa `127.0.0.1` localmente; no expongas `0.0.0.0` sin proxy HTTPS. |
| `SETAREH_MERCHANT_ID` / `SETAREH_MERCHANT_NAME` | No | Identidad del comercio piloto. |
| `SETAREH_USDC_PER_CLP` | Sí | Tasa fija de demo usada para convertir el total Shopify a USDC. |
| `SETAREH_FX_SOURCE` | No | Etiqueta de auditoría de la tasa configurada. |
| `SETAREH_FLAT_SHIPPING_CLP` | No | Costo fijo de despacho incorporado al draft. |
| `SETAREH_SHIPPING_TITLE` | No | Nombre del despacho en Shopify. |
| `SETAREH_MAX_QUOTE_USDC` | No | Tope de gasto del servidor; por defecto `30`. |
| `QUOTE_TTL_MINUTES` | No | Vida del quote; por defecto `10` minutos. |

La tasa y el total USDC se congelan dentro de cada quote. Si cambian artículos,
cantidad, dirección, despacho o presupuesto, descarta el quote y crea otro.

## Stellar y x402

| Variable | Requerida | Propósito |
| --- | --- | --- |
| `STELLAR_NETWORK` | Sí | Debe ser `stellar:testnet` en este MVP. |
| `STELLAR_PAYMENT_ASSET` | Sí | Debe ser `USDC`. |
| `STELLAR_MERCHANT_ADDRESS` | Sí | Dirección pública Stellar receptora; Setareh valida su formato. |
| `X402_FACILITATOR_URL` | No | URL del facilitador; por defecto `https://x402.org/facilitator`. |
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
| `AGENT_STELLAR_PRIVATE_KEY` | Clave privada testnet; jamás llega a Setareh. |
| `AGENT_MAX_USDC` | Límite local que la wallet permite gastar. |

El cliente de referencia rechaza una red, activo o importe que no cumpla estas
restricciones antes de firmar. Mantén `AGENT_MAX_USDC` igual o por debajo del
límite del servidor.
