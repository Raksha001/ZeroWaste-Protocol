# Smart-Sweep Checkout 🧹

> **Pay x402 paywalls with your wallet's trash.** A Web3 agentic payment bot that converts worthless "dust" tokens into stablecoin payments on X Layer — all in a single checkout flow.

Built for the **OKX "Build X" Hackathon** 🏗️

---

## 🎯 What It Does

You have $2 of Token A, $1.50 of Token B, and $3 of Token C sitting idle in your wallet — worthless individually, but together worth $6.50. Smart-Sweep Checkout liquidates this dust to pay for goods and services via the **x402 Payment Required** protocol.

**The Flow:**
1. 📎 Paste a paywalled URL into the Telegram bot
2. 🔍 Bot detects the x402 payment requirement ($5 USDT)
3. 🗑️ Bot scans your wallet for dust tokens on X Layer
4. 🔄 Bot calculates optimal swap routes via OKX DEX Aggregator
5. ✅ You click "Approve" → dust is swept → merchant is paid → content unlocked

No USDT in your wallet? No problem. Your garbage tokens handle it.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  TELEGRAM BOT                    │
│              (src/bot/index.ts)                  │
│                                                  │
│  /setwallet  ·  /dust  ·  URL detection         │
└──────────┬──────────┬──────────┬────────────────┘
           │          │          │
     ┌─────▼─────┐ ┌──▼───┐ ┌───▼────────────────┐
     │ Wallet    │ │ Swap │ │ Payment             │
     │ Scanner   │ │Router│ │ Verifier            │
     │           │ │      │ │                     │
     │ okx-      │ │ okx- │ │ ethers.js +         │
     │ wallet-   │ │ dex- │ │ X Layer RPC         │
     │ portfolio │ │ swap │ │                     │
     └─────┬─────┘ └──┬───┘ └───┬────────────────┘
           │          │          │
     ┌─────▼──────────▼──────────▼────────────────┐
     │            X LAYER (Chain ID: 196)          │
     │                                              │
     │  Token Approvals → DEX Swaps → USDT Transfer │
     │                                              │
     │  DustSweeperMulticall.sol (atomic fallback)  │
     └──────────────────────────────────────────────┘
           │
     ┌─────▼──────────────────────────────────────┐
     │           MOCK MERCHANT SERVER              │
     │         (src/merchant/server.ts)            │
     │                                              │
     │  GET /premium-article → 402 + x402 JSON     │
     │  POST /confirm-payment → unlock content     │
     └────────────────────────────────────────────┘
```

---

## 🔧 Onchain OS Skills Used

| Skill | Purpose |
|---|---|
| `okx-agentic-wallet` | Agent's onchain identity for signing transactions |
| `okx-wallet-portfolio` | Scanning user wallets for dust tokens on X Layer |
| `okx-dex-swap` | Computing optimal swap routes (dust → USDT) via 500+ DEX sources |
| `okx-x402-payment` | Handling the HTTP 402 payment protocol |
| `okx-onchain-gateway` | Broadcasting & tracking transactions on X Layer |
| `okx-security` | Pre-simulating swap transactions before execution (bonus) |

---

## 🚀 Setup & Run

### Prerequisites

- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- OKX API credentials (from [OKX Developer Portal](https://web3.okx.com/onchain-os/dev-portal))
- X Layer wallet with OKB for gas

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/smart-sweep-checkout.git
cd smart-sweep-checkout
npm install
```

### Configuration

```bash
cp .env.example .env
# Fill in your credentials in .env
```

### Run (Mock Mode)

```bash
# Terminal 1: Start the mock merchant
npm run start:merchant

# Terminal 2: Start the Telegram bot
npm run start:bot

# Or run both together:
npm run dev
```

### Run E2E Test (no Telegram needed)

```bash
# Start merchant server first, then:
npm test
```

---

## 📄 Smart Contract

### `DustSweeperMulticall.sol`

Deployed on **X Layer Mainnet**.

**Deployment Address:** `[TO BE FILLED AFTER DEPLOYMENT]`

The contract provides an atomic fallback path: it receives multiple encoded swap calls, executes them in sequence, verifies the total USDT output meets the x402 requirement, and forwards the payment to the merchant. If the swaps don't produce enough USDT, the **entire transaction reverts** — protecting the user's tokens.

For the primary flow, we use sequential approve→swap via OKX DEX API for maximum reliability.

---

## 🔄 Working Mechanics

### The Checkout Loop

1. **Intercept** — User pastes a URL into Telegram
2. **Detect** — Bot sends GET request, receives HTTP 402 with x402 payment JSON
3. **Scan** — Bot queries OKX Wallet Portfolio API for dust tokens on X Layer
4. **Select** — Algorithm picks optimal dust basket (≥ required amount + 5% slippage buffer)
5. **Route** — OKX DEX Aggregator computes swap paths for each dust token → USDT
6. **Propose** — Bot shows the user a clean breakdown with "Approve" button
7. **Execute** — For each dust token: approve → swap → USDT
8. **Pay** — USDT transferred to merchant wallet
9. **Unlock** — Bot fetches content with payment receipt

### Key Design Decisions

- **OKX DEX Aggregator over raw Uniswap SOR** — Better fill rates for small/illiquid token swaps on X Layer
- **Sequential swaps over atomic multicall for mainnet** — More reliable with varied token approvals
- **5% slippage buffer** — Accounts for price movement between quote and execution
- **Parallel route computation** — All swap routes calculated concurrently via `Promise.all`

---

## 🏆 Project Positioning in X Layer Ecosystem

Smart-Sweep Checkout demonstrates:

1. **Real-world x402 utility** — Not just a payment demo, but a complete paywall → payment → content delivery cycle
2. **Deep Onchain OS integration** — Uses 6 Onchain OS skills in a single coherent flow
3. **X Layer as a payment rail** — Low gas fees make multi-swap dust liquidation economically viable
4. **Agentic autonomy** — The bot independently identifies, prices, routes, and executes without human intervention beyond final approval

---

## 👥 Team

| Name | Role |
|---|---|
| [Your Name] | Full-stack development & architecture |

---

## 📜 License

MIT
