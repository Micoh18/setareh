---
title: Setareh Docs
description: Documentación pública para operar e integrar Setareh.
template: splash
hero:
  title: Comercio verificable para agentes
  tagline: Consulta catálogo, fija un quote, liquida USDC testnet y crea una orden Shopify verificable.
  actions:
    - text: Abrir runbook
      link: /runbook/
      icon: right-arrow
    - text: Uso por agentes
      link: /agentes/
      variant: minimal
---

## Qué es Setareh

Setareh conecta un agente con un comercio Shopify para completar compras bajo
un flujo verificable. Shopify conserva la fuente de verdad de catálogo,
inventario y pedidos; Setareh crea quotes y valida el pago antes de crear una
orden.

## Flujo

1. El agente busca productos y verifica disponibilidad.
2. Crea un quote con productos, despacho y vencimiento.
3. La persona confirma explícitamente la compra.
4. La wallet liquida USDC por x402 en Stellar testnet.
5. Setareh valida el pago y crea una única orden Shopify.

## Documentos disponibles

- [Runbook operativo](/runbook/): preparación, ejecución, incidentes y
  conciliación.
- [Uso por agentes](/agentes/): cómo consultar esta documentación y los límites
  de seguridad aplicables.
