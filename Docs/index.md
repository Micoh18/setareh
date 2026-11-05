---
title: Documentación de Setareh
description: Consulta catálogo, fija un quote, liquida USDC testnet y crea una orden Shopify verificable.
tableOfContents: false
editUrl: false
lastUpdated: false
pagefind: false
prev: false
next: false
---

## Qué es Setareh

Setareh conecta un agente con un comercio Shopify para completar compras bajo
un flujo verificable. Shopify es el primer conector: conserva la fuente de
verdad de catálogo, inventario y pedidos; Setareh crea quotes y valida el pago
antes de crear una orden.

La implementación pública actual sólo integra Shopify. La evolución a otros
backoffices requiere adaptadores de comercio explícitos y no debe anunciarse
como capacidad disponible antes de implementarla.

## Flujo

1. El agente busca productos y verifica disponibilidad.
2. Crea un quote con productos, despacho y vencimiento.
3. La persona confirma explícitamente la compra.
4. La wallet liquida USDC por x402 en Stellar testnet.
5. Setareh valida el pago y crea una única orden Shopify.
