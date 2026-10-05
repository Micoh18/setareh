---
title: Uso por agentes
description: Cómo usar la documentación pública de Setareh de forma segura.
---

## Fuentes públicas

Un agente puede consultar las páginas del portal, el archivo `/llms.txt` para
un índice breve y `/llms-full.txt` para un resumen compacto y procesable. El
contenido de `Docs/` es la fuente canónica que el sitio publica durante el
build.

La búsqueda integrada del portal sirve para exploración por personas. Para
respuestas operativas, prioriza el runbook y valida siempre contra el estado
real del backend, Shopify y el facilitador.

## Reglas de operación

- Solicita confirmación explícita antes de iniciar un pago.
- No reutilices un quote vencido ni lo modifiques: crea uno nuevo.
- No expongas claves privadas, tokens, direcciones de envío, correos ni
  receipts crudos de pago.
- El MVP admite sólo `USDC` en `stellar:testnet`; rechaza cualquier otro activo
  o red.
- Ante pago liquidado con una orden en revisión, detén los reintentos y ejecuta
  la conciliación indicada en el runbook.

## Próximo nivel de integración

Este portal prepara contenido estático, indexable y con URLs estables. Una
integración posterior puede exponer búsqueda documental vía MCP o una API de
retrieval, sin trasladar documentación privada ni secretos a ese índice.
