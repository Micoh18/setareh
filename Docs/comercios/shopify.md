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

## Instalar la app

La persona dueña o administradora recibe un enlace de instalación del equipo
de Setareh, lo abre con su propia sesión de Shopify y aprueba los permisos en
la pantalla de Shopify. Shopify devuelve el control a Setareh, que verifica la
firma de Shopify, el dominio de la tienda y un identificador de un solo uso que
vence a los 10 minutos antes de guardar el acceso cifrado. Ese acceso se
renueva solo.

Para instalar, Setareh **nunca** pide:

- la contraseña de Shopify ni códigos MFA o de recuperación;
- copiar o enviar tokens, client ID o client secret;
- instalar programas ni dar acceso remoto al computador;
- claves de ninguna wallet;
- datos de clientes de la tienda.

Si alguien pide alguna de esas cosas en nombre de Setareh, no es Setareh. El
enlace legítimo lleva siempre a la pantalla «Instalar app» de Shopify con el
nombre de la app registrada.

## Qué muestra la pantalla de Shopify

Shopify no enseña los scopes técnicos de la tabla siguiente, sino un aviso y
tres categorías en lenguaje llano. Así se vio en el piloto:

- **«Esta app aún no se ha revisado».** Es normal: Setareh se instala por
  distribución personalizada en una sola tienda y no pasa por la revisión de la
  App Store de Shopify. El aviso pide confiar en el desarrollador; esta guía y
  la [evidencia](/evidencia/) existen para que esa confianza tenga base.
- **«Ver datos de clientes: datos sensibles, datos del dispositivo y de la
  actividad».** Aparece porque el acceso a pedidos incluye los datos de quien
  compra (nombre, dirección, correo). Setareh sólo lee el pedido que acaba de
  crear, para conciliarlo; en el piloto esos datos son los que el propio agente
  envió al cotizar.
- **«Ver datos de empleados y colaboradores: propietario de tienda».** Lo
  muestra para cualquier app: según Shopify, toda app instalada tiene acceso a
  los datos de contacto de la cuenta propietaria de la tienda, pida el scope
  que pida. No corresponde a un permiso de Setareh que se pueda quitar, y
  Setareh no consulta empleados ni colaboradores.
- **«Ver y editar datos de la tienda: productos, pedidos».** Es el uso real:
  leer catálogo y stock, crear el borrador de pedido y completarlo tras el pago.

Al desplegar cada categoría se ven los permisos técnicos. Shopify puede
mostrar cuatro en lugar de cinco porque agrupa `read_orders` dentro de
`write_orders`; es normal y el preflight lo acepta.

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

## Operación

En Shopify Admin el comercio puede revisar drafts, nuevas órdenes, stock y el
metafield de evidencia. Para pausar el piloto sin desinstalar, pide al equipo
de Setareh que deshabilite el comercio en su entorno.

## Desinstalar

La persona dueña revoca el acceso por completo desde su sesión, sin avisar ni
entregar nada:

1. Shopify Admin → **Settings → Apps and sales channels**.
2. Localizar **Setareh** → **Uninstall** → confirmar.
3. Opcional: borrar en **Orders → Drafts** los drafts de prueba con etiqueta
   `setareh` que no se completaron. Setareh no los necesita.

Qué ocurre después:

| Quién | Qué |
| --- | --- |
| Shopify | Revoca los tokens de la app y envía a Setareh el webhook `app/uninstalled`, firmado. |
| Setareh | Verifica la firma, marca la instalación como desinstalada y borra sus copias de los tokens. Cualquier intento de cotizar en esa tienda falla con un error de instalación, no con datos. |

Qué permanece y quién lo borra, si quiere:

| Permanece | Dónde | Quién lo borra |
| --- | --- | --- |
| Productos, inventario, órdenes creadas por Setareh con su nota, etiqueta y metafield `setareh.stellar_payment`. | Shopify | El comercio, con las herramientas normales de Shopify. Setareh no toca la tienda al desinstalar. |
| Historial de quotes, pagos y órdenes, y la pista de auditoría. | Setareh | Según la [política de retención](/operaciones/logs-y-retencion/). |
| Un registro de que hubo una instalación y cuándo terminó, sin tokens. | Setareh | Se conserva. |

Lo que desaparece: los tokens (revocados por Shopify y borrados por Setareh) y
la capacidad de Setareh de leer catálogo, crear drafts o completar órdenes en
esa tienda.

Para volver a conectar la tienda se repite la instalación; Shopify entrega
tokens nuevos. Antes de desinstalar conviene que no haya quotes en
`payment_pending`, `payment_unknown` ni `manual_review`, porque Setareh no
podrá completar sus órdenes después (ver
[estados y recuperación](/operaciones/estados-y-recuperacion/)).
