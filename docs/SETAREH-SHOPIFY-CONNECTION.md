# Conectar Micohstore con Setareh

Esta guía conecta el servidor MCP local de Setareh con la Admin API de Shopify. Las apps creadas en el Dev Dashboard usan un **Client ID** y un **Client secret**: el secreto no debe aparecer en chat, Git, capturas ni documentos públicos.

## 1. Configurar e instalar la app

En Shopify Dev Dashboard, abre `Setareh MCP`:

1. Confirma los alcances `read_products`, `read_inventory` y `write_draft_orders`.
2. Publica o libera la versión activa que contiene esos alcances.
3. En el panel general, presiona **Instalar app**.
4. Selecciona Micohstore y confirma la instalación.

La app no necesita estar incrustada ni tener una URL funcional para este MCP local. `https://example.com` es suficiente por ahora.

## 2. Copiar credenciales sólo al entorno local

En PowerShell, desde `D:\Findurway\backend`:

```powershell
Copy-Item .env.example .env
```

Abre `.env` y escribe los datos del panel de **Credenciales**:

```dotenv
SHOPIFY_STORE_DOMAIN=t9efbk-0a.myshopify.com
SHOPIFY_CLIENT_ID=pega_tu_id_de_cliente
SHOPIFY_CLIENT_SECRET=pega_tu_secreto_de_cliente
```

No envíes el secreto por chat. Setareh lo intercambia localmente mediante el flujo `client_credentials` por un token de Admin API que dura 24 horas y se renueva automáticamente.

## 3. Ejecutar y verificar

```powershell
cd D:\Findurway\backend
npm run check
npm run dev
```

El proceso queda esperando a un cliente MCP; no abrirá una página por sí mismo. Para conectarlo a Codex, agrega la configuración indicada en [`backend/README.md`](../backend/README.md).

## 4. Primer flujo seguro

1. El agente llama `search_catalog`.
2. El agente llama `check_availability` con la variante y cantidad escogidas.
3. Si el estado es `MADE_TO_ORDER`, informa el plazo al comprador antes de continuar.
4. Sólo con artículos, dirección y total confirmados por la persona, llama `create_draft_order` con `userConfirmed: true`.
5. El resultado siempre se presenta como **borrador de Shopify**. En modo demo no es un pago Stellar confirmado.

## Próxima fase: Stellar

Antes de completar pedidos, Setareh debe crear un payment intent de un solo uso y verificar en Stellar: hash de transacción, cuenta destino, activo, monto, memo y estado exitoso. Recién después podrá completar el borrador u otra operación de orden autorizada.

Referencias: [client credentials grant de Shopify](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant), [permisos y creación de borradores de Shopify](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate), [SDK oficial MCP para TypeScript](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server).
