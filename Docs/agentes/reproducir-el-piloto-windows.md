---
title: Reproducir el piloto (Windows)
description: Guía para que una persona evaluadora, sin conocimientos técnicos, haga una compra de prueba y un reintento controlado conversando con un agente que usa el MCP de Setareh y su propia wallet testnet.
---

Esta es la versión para **Windows 10 u 11** con PowerShell. Si vas a usar un
Mac, sigue [Reproducir el piloto (macOS)](/agentes/reproducir-el-piloto/).

## Qué vas a comprobar

Que un agente de IA puede comprar en una tienda Shopify real pagando con USDC
de prueba en Stellar testnet, y que si intenta pagar la misma compra dos
veces, Setareh rechaza la segunda sin cobrar ni crear otra orden.

Tú no escribes comandos de pago ni tocas la red Stellar. Conversas en
español con un agente (Claude Code) que tiene las herramientas de Setareh
y una wallet de prueba que controlas tú. No hay dinero real, no se despacha
nada y Setareh nunca ve tu clave secreta: se queda en un archivo de tu
computador que sólo lee el agente local.

Tiempo estimado: 45 minutos la primera vez, incluida la instalación.

## Antes de empezar: lo que te envía Setareh

Por el canal privado recibes tres datos. Sin ellos no sigas:

| Dato | Para qué |
| --- | --- |
| Día y hora de la ventana de prueba | Durante la ventana el fundador está disponible por chat, pero no interviene |
| Nombre del producto de prueba | Se lo pedirás al agente en el paso 5 |
| Un canal para enviar la evidencia | Nada se publica sin tu autorización |

También necesitas una cuenta de Claude con acceso a Claude Code (plan Pro o
Max). Si no la tienes, díselo a Setareh antes de la ventana.

## 1. Instalar tres programas

Todo es "Siguiente, Siguiente, Finalizar" con las opciones por defecto.

1. **Node.js**: descarga la versión LTS en [nodejs.org](https://nodejs.org/)
   e instálala.
2. **Git**: descarga e instala desde [git-scm.com](https://git-scm.com/download/win).
3. **Claude Code**: abre PowerShell (tecla Windows, escribe `PowerShell`,
   Enter), pega esta línea y pulsa Enter:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

Cierra PowerShell y vuelve a abrirlo para que reconozca los tres programas.
Escribe `claude` y pulsa Enter: la primera vez te abre el navegador para que
inicies sesión con tu cuenta de Claude. Cuando termine, escribe `/exit`.

## 2. Crear tu wallet de prueba

1. Entra en [Stellar Lab](https://lab.stellar.org/account/create). Arriba a
   la derecha elige la red **Testnet**. Pulsa **Generate keypair**.
2. Verás dos claves. La **pública** empieza con `G` y la **secreta** con `S`.
   Copia las dos en un bloc de notas de tu computador. La secreta no se
   comparte con nadie, ni con Setareh ni con el agente en el chat.
3. Pulsa **Fund account with Friendbot**. Eso crea la cuenta con XLM de
   prueba para las comisiones.
4. Entra en el [faucet de Circle](https://faucet.circle.com/). Elige
   **Stellar Testnet**, pega tu clave **pública** y pide USDC. Recibes 10 USDC
   de prueba. Si el faucet falla, mira la tabla final: Setareh puede
   enviarte USDC de prueba a tu clave pública.

## 3. Descargar Setareh

En PowerShell pega estas líneas una por una, pulsando Enter tras cada una.
La última tarda uno o dos minutos:

```powershell
cd ~
git clone https://github.com/Micoh18/setareh.git
cd setareh\backend
npm.cmd ci
```

## 4. Guardar tu clave en el archivo de la wallet

Sigue en la misma ventana de PowerShell:

```powershell
notepad agent.env
```

El Bloc de notas pregunta si quieres crear el archivo: pulsa **Sí**. Pega
estas tres líneas, cambia `<tu clave secreta S...>` por tu clave secreta
(sin los signos `<` `>`) y guarda con Ctrl+S:

```ini
SETAREH_API_URL=https://api.setareh.site
AGENT_MAX_USDC=5
AGENT_STELLAR_PRIVATE_KEY=<tu clave secreta S...>
```

`AGENT_MAX_USDC=5` es tu tope: el agente local se niega a firmar cualquier
pago mayor a 5 USDC, aunque alguien se lo pida. El producto de prueba cuesta
menos.

Ese archivo nunca se envía a nadie. Puedes cerrar el Bloc de notas.

## 5. Abrir el agente y hacer la compra

En PowerShell:

```powershell
cd ~\setareh
claude
```

Claude Code detecta que el proyecto trae un servidor MCP llamado `setareh`
y pregunta si lo autorizas: elige **Yes**. Desde ahí todo es conversación.
Pega los mensajes siguientes **uno por uno**, en este orden, y espera la
respuesta de cada uno. Cuando el agente pida permiso para usar una
herramienta de Setareh o para crear un archivo, responde **Yes**.

El agente ya sabe cómo funciona el piloto: conoce las herramientas, el orden
de los pasos y qué hacer en cada uno. Tú sólo le hablas como le hablarías a
una persona. No necesitas nombrar herramientas ni códigos; si prefieres
decirlo con tus palabras, hazlo, siempre que pidas lo mismo.

**Mensaje 1, comprobar que todo está listo**

```text
¿Está todo listo para hacer la compra de prueba? Revisa mi wallet y dime si falta algo. Todavía no compres nada.
```

Debes ver todos los puntos en ok, tu clave pública (la que empieza con `G`)
y tu saldo de USDC de prueba. Si algo falla, corrígelo antes de seguir.

**Mensaje 2, encontrar el producto** (cambia el nombre por el que te dio Setareh)

```text
Busca en la tienda el producto "Prueba evaluador Setareh" y dime cuánto cuesta y si está disponible.
```

**Mensaje 3, pedir la cotización**

```text
Quiero comprar una unidad. Mis datos: Prueba Setareh, evaluacion@example.com, Calle de prueba 123, Santiago, Chile, código postal 8320000. Prepara la cotización y dime cuánto es en USDC y hasta cuándo vale. No pagues todavía.
```

El agente te muestra un identificador de la cotización (el `quoteId`), un
`requestId`, el total en USDC y la hora de vencimiento. La cotización vence
a los 10 minutos. Sigue de inmediato con los mensajes 4 y 5.

**Mensaje 4, pagar**

```text
Sí, confirmo. Págala y muéstrame el comprobante completo tal como lo devuelve Setareh. Después confirma en la red Stellar que el pago realmente pasó.
```

Debes ver `status: created`, un nombre de orden como `#1005`, un hash largo
(el `transactionHash`) y la verificación en Stellar con `successful: true`.
Esa es la compra.

**Mensaje 5, el reintento controlado**

```text
Págala otra vez. Quiero ver qué pasa si intento cobrar la misma compra dos veces. Muéstrame la respuesta tal cual, sin resumirla, y luego dime si sigue habiendo una sola orden y un solo pago.
```

El agente no debe negarse ni preparar una cotización nueva: reintenta la
misma. Debes ver `outcome: rejected_before_payment` con código `409`, el
mensaje `Quote is not payable in status created` y un campo `meaning` que
explica en español que Setareh rechazó el segundo cobro antes de que se
firmara nada. El estado debe seguir siendo `created` con la misma orden y
el mismo hash.

**Mensaje 6, guardar la evidencia**

```text
Guarda la evidencia de todo lo que hicimos en una carpeta llamada evidencia dentro de backend, un archivo por paso y en orden. No incluyas nada de agent.env. Al final dime en qué commit está el código.
```

El agente crea siete archivos, de `01-check.json` a `07-orden-final.json`,
y te dice un commit de 7 caracteres. Anota el commit que te diga. Luego haz una captura de pantalla de la
respuesta del mensaje 4 y otra de la del mensaje 5 (tecla Windows+Shift+S).
Escribe `/exit` para cerrar el agente.

## 6. Qué enviar

Por el canal privado:

- La carpeta `evidencia` comprimida. Está en `C:\Users\<tu usuario>\setareh\backend\evidencia`.
  Clic derecho sobre la carpeta, **Enviar a**, **Carpeta comprimida**.
- Las dos capturas de pantalla.
- El commit del mensaje 6.
- Cualquier cosa que no haya salido como describe esta página, con tus
  palabras. Un fallo es un hallazgo válido, no un motivo para repetir hasta
  que salga bien.

Nunca envíes `agent.env` ni tu clave secreta. El `transactionHash` es público
y puede publicarse.

## Qué debes ver en cada paso

| Paso | Señal de que fue bien |
| --- | --- |
| Mensaje 1 | Todos los puntos en ok y un saldo de USDC mayor que el precio del producto |
| Mensaje 2 | El producto aparece con `canPurchase: true` |
| Mensaje 3 | Un `quoteId`, un total menor a 5 USDC y una hora de vencimiento a 10 minutos |
| Mensaje 4 | `status: created`, nombre de orden, hash y `successful: true` en Horizon |
| Mensaje 5 | `rejected_before_payment`, código `409`, un `meaning` en español, y el estado sigue con una sola orden y el mismo hash |
| Mensaje 6 | Siete archivos en la carpeta y un commit de 7 caracteres |

## Si algo falla

| Qué ves | Qué significa | Qué hacer |
| --- | --- | --- |
| El faucet de Circle no entrega USDC | El faucet tiene cupo diario y a veces falla | Envía tu clave **pública** (`G...`) por el canal privado; Setareh te transfiere USDC de prueba y anota el hash de esa transferencia |
| En el mensaje 1 falla `account` | Friendbot no llegó a crear la cuenta | Repite **Fund account with Friendbot** en Stellar Lab y vuelve a enviar el mensaje 1 |
| En el mensaje 1 falla `usdc` | El faucet no corrió o usaste otra clave | Pide USDC en el faucet con la misma clave pública que muestra el agente |
| En el mensaje 1 falla `AGENT_STELLAR_PRIVATE_KEY` | La clave quedó mal pegada en `agent.env` | Abre de nuevo `notepad agent.env`, revisa que empieza con `S`, tiene 56 caracteres y no tiene espacios ni `<` `>` |
| Claude Code no muestra el servidor `setareh` | Abriste `claude` en otra carpeta o dijiste No a la autorización | Escribe `/exit`, ejecuta `cd ~\setareh` y vuelve a abrir `claude` |
| El agente no encuentra el producto | Aún no está publicado o el nombre es distinto | Confirma el nombre exacto con Setareh por el canal privado |
| En el mensaje 5 el agente dice que ya está pagada y no reintenta | Ignoró las instrucciones del servidor | Insiste: "Sí, ya sé que está pagada; quiero que intentes cobrarla de nuevo con la misma cotización". Anota que hizo falta insistir: es un hallazgo |
| Código `429` al crear el quote | Límite de 10 quotes por hora | Espera los segundos que indique y repite el mensaje 3 |
| `Quote expired` en el mensaje 4 | Pasaron más de 10 minutos | Repite el mensaje 3 para pedir una cotización nueva. Es una compra nueva, no un reintento |
| Error extraño o tiempo de espera durante el mensaje 4 | El cobro pudo o no haber ocurrido | **No pidas otra cotización.** Pregunta al agente "¿cómo quedó la compra?" y envía lo que responda, aunque diga `payment_unknown` o `manual_review` |

Los estados y su recuperación están en
[Estados y recuperación](/operaciones/estados-y-recuperacion/).

## Para evaluadores técnicos

El servidor MCP que usa el agente es `backend/src/agent-mcp.ts` y está
declarado en `.mcp.json` en la raíz del repositorio. Expone `check_setup`,
`search_catalog`, `check_availability`, `create_quote`,
`pay_and_place_order`, `get_order_status` y `verify_payment`, todas contra
la API pública; la firma x402 ocurre dentro de ese proceso con la clave de
`agent.env`. Si prefieres no usar un agente, el mismo flujo existe como
comandos: `npm.cmd run demo:check` y `npm.cmd run demo:pay -- <quoteId>`
desde `backend`, con el quote creado por `POST /v1/quotes`; ver
[Checkout para agentes](/agentes/checkout/) y la
[referencia MCP](/referencia/mcp/). Con Codex CLI, el mismo servidor se
declara en `~/.codex/config.toml`:

```toml
[mcp_servers.setareh]
command = "node"
args = ["backend/node_modules/tsx/dist/cli.mjs", "backend/src/agent-mcp.ts"]
cwd = "C:/Users/<tu usuario>/setareh"
```
