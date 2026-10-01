# Setareh Shopify MCP

MCP server that makes a Shopify store safely discoverable and purchasable by an agent.

It exposes four tools:

- `search_catalog`: searches active Shopify products and returns variant IDs, price and availability.
- `check_availability`: classifies a variant as `READY_TO_SHIP`, `MADE_TO_ORDER`, or `OUT_OF_STOCK`.
- `create_draft_order`: creates a real Shopify **draft** order only after `userConfirmed: true`; it never completes an order or captures payment.
- `get_draft_order_status`: reads the draft's Shopify status.

## Setup

1. In Shopify Dev Dashboard, create and install the custom app in Micohstore.
2. Give it the Admin API scopes `read_products`, `read_inventory`, and `write_draft_orders`, then release that version.
3. Copy the app's **Client ID** and **Client secret** into a new `backend/.env` file using `.env.example` as the template. The server exchanges them locally for a 24-hour Admin API token; no token needs to be copied from Shopify.
4. Install and verify:

   ```powershell
   cd backend
   npm install
   npm run check
   npm run dev
   ```

The server uses stdio, so its standard output belongs exclusively to MCP. Diagnostic logs go to standard error.

## Codex MCP configuration

Add this to your Codex MCP configuration after the project has dependencies installed:

```toml
[mcp_servers.setareh]
command = "npx.cmd"
args = ["tsx", "D:/Findurway/backend/src/index.ts"]
cwd = "D:/Findurway/backend"
```

## Payment boundary

`SETAREH_PAYMENT_MODE=demo` is only for the hackathon: it creates a draft marked `setareh:demo-payment` and requires a provided transaction reference, but does not claim on-chain settlement was verified.

The next implementation step is `live` mode: verify a Stellar transaction against the expected asset, destination, amount, memo, and a one-time payment intent before calling `draftOrderComplete`. Until then, an agent must never present a draft as a paid order.
