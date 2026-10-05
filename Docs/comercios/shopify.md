---
title: Conectar un comercio Shopify
description: Requisitos, permisos y comprobaciones para el comercio que usa Setareh.
---

## Antes de conectar

La persona administradora debe decidir qué productos se ofrecerán y revisar que
estén activos, tengan precio y cuenten con inventario o política de pedido por
encargo. Para el piloto usa una tienda de desarrollo y Stellar testnet.

Setareh no necesita la contraseña de la tienda ni una clave privada de wallet.
Las credenciales de la app pertenecen al entorno seguro del backend.

## Permisos solicitados

| Scope | Motivo |
| --- | --- |
| `read_products` | Consultar productos, variantes y precios activos. |
| `read_inventory` | Comprobar stock al cotizar y antes de completar. |
| `write_draft_orders` | Crear el draft que fija la cotización. |
| `read_orders` | Conciliar el ID y estado de la orden resultante. |
| `write_orders` | Adjuntar evidencia resumida de pago a la orden. |

## Qué ocurre en Shopify

Al crear un quote, Setareh crea un draft order con las líneas, dirección y
despacho fijo configurado. Añade una etiqueta `setareh`, un identificador de
quote y una nota para conciliación. Después de payment settlement válido,
completa ese mismo draft.

Al finalizar, adjunta el metafield JSON `setareh.stellar_payment` con el ID del
quote, red, activo y hash de transacción cuando existe. No guarda el receipt
crudo del facilitador en ese metafield.

## Verificación de instalación

Ejecuta:

```powershell
cd backend
npm.cmd run doctor -- --verify
```

El preflight debe confirmar conexión, scopes, una consulta de catálogo y
capacidad x402 para `stellar:testnet`. Realiza después una compra de prueba de
bajo importe y verifica una orden real en Shopify Admin.

## Operación y revocación

En Shopify Admin el comercio puede revisar drafts, nuevas órdenes, stock y el
metafield de evidencia. Para pausar el piloto, deshabilita el comercio en el
entorno Setareh. Para revocar el acceso a la tienda, desinstala la app desde
**Settings → Apps and sales channels**; esto no borra productos ni órdenes ya
existentes.
