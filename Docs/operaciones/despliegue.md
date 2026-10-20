---
title: Despliegue y release
description: Cómo publicar la API HTTP de Setareh de forma repetible, sin compartir secretos.
---

Esta guía describe el proceso de release del entorno de piloto. No nombra al
proveedor de infraestructura ni sus consolas de administración: esos datos son
operativos y se conservan en documentación privada. Con ella, una persona
técnica puede desplegar el servicio sin recibir ningún secreto.

## Qué se despliega

- La imagen de `backend/Dockerfile`: Node 24, compilación en dos etapas, modo
  `SETAREH_TRANSPORT=http`. No inicia MCP por `stdio`; el MCP sigue siendo
  local al runtime del agente.
- Una sola instancia. SQLite guarda quotes, pagos, órdenes e instalaciones
  Shopify, y no se comparte entre réplicas. Mientras la base sea SQLite, no se
  habilita alta disponibilidad ni escalado horizontal.
- Un volumen persistente montado en `/data`, con
  `SETAREH_DATABASE_PATH=/data/setareh.db`. Un sistema de archivos efímero
  perdería la idempotencia y la evidencia de conciliación en cada reinicio.
- Terminación HTTPS delante del contenedor, con redirección de HTTP a HTTPS y
  un health check de plataforma sobre `GET /health`.

## Dónde vive cada dato

| Dato | Lugar | Regla |
| --- | --- | --- |
| Configuración no secreta (red, activo, dirección pública receptora, tasa, topes, dominio de tienda, versión de API, `SETAREH_BASE_URL`) | Variables de entorno del despliegue | Versionadas fuera del repositorio público; sin valores sensibles |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SETAREH_TOKEN_ENCRYPTION_KEY` | Gestor de secretos del proveedor | Se cargan desde `stdin` o desde el panel; nunca en archivos del repo, logs ni capturas |
| Tokens OAuth de cada tienda | SQLite en el volumen, cifrados con AES-256-GCM | Se renuevan solos; se borran al desinstalar |
| `AGENT_STELLAR_PRIVATE_KEY`, `STELLAR_MERCHANT_PRIVATE_KEY`, `agent.env`, `merchant-wallet.env` | Fuera del servidor | El servidor sólo conoce la dirección pública receptora |

`SETAREH_TOKEN_ENCRYPTION_KEY` son 32 bytes aleatorios en base64. Si se pierde,
los tokens guardados dejan de poder descifrarse y las tiendas deben volver a
instalar la app. Trátala como el secreto más sensible del despliegue.

## Procedimiento de release

1. Trabaja en una rama. En `backend/`: `npm ci`, `npm run check`, `npm test`.
2. Abre o actualiza el pull request y espera el CI en verde. El workflow
   instala dependencias bloqueadas, audita las de producción, verifica
   TypeScript, ejecuta las pruebas, revisa que `Docs/` no contenga secretos y
   construye este portal.
3. Despliega la imagen desde `backend/` con la herramienta del proveedor. La
   construcción debe hacerse desde el Dockerfile; no se suben `.env`,
   `agent.env` ni archivos SQLite.
4. Verifica:
   - `GET https://api.setareh.site/health` devuelve `200` con `ok: true`,
     `service: setareh` y `network: stellar:testnet`.
   - `http://` redirige a `https://` con `301`.
   - El log de arranque indica el modo de autenticación Shopify esperado y si
     las rutas de instalación OAuth están habilitadas.
5. Ejecuta el preflight dentro de la instancia desplegada:
   `node dist/doctor.js --verify`. Debe confirmar conexión Shopify, scopes,
   estado de la instalación OAuth y capacidad `exact` del facilitador en
   `stellar:testnet`.
6. Si cambiaste configuración no secreta, edítala en el entorno del despliegue
   y vuelve a desplegar. Si cambiaste un secreto, cárgalo en el gestor del
   proveedor y vuelve a desplegar; nunca lo pegues en el repositorio.
7. Para volver atrás, redepliega la imagen de la release anterior. El volumen
   no se toca.

## Rotación de credenciales

- **Client secret de Shopify:** regenéralo en el Dev Dashboard, actualiza el
  secreto en el proveedor y redepliega. Los tokens OAuth guardados siguen
  siendo válidos; sólo la renovación usa el secreto nuevo.
- **Clave de cifrado de tokens:** cambiarla invalida los tokens guardados.
  Planifica una reinstalación de cada tienda antes de rotarla.
- **Dirección receptora Stellar:** es configuración no secreta, pero cambia el
  destinatario de todos los quotes nuevos. Verifica el preflight y una compra
  de prueba después de cambiarla.

## Verificación de cierre

- [ ] Imagen construida desde el Dockerfile del commit revisado.
- [ ] Una sola instancia, con volumen montado y reinicio sin pérdida de datos.
- [ ] HTTPS válido, redirección desde HTTP y `GET /health` público.
- [ ] Preflight `--verify` en verde dentro de la instancia.
- [ ] Secretos sólo en el gestor del proveedor; ninguno en Git, logs ni docs.
- [ ] CI en verde sobre el commit desplegado y enlace registrado en la evidencia.
