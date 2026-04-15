# ZeroWaste Protocol 🧹

> **Pay x402 paywalls with your wallet's trash.** An AI-powered Web3 payment agent that converts worthless "dust" tokens into stablecoin payments on X Layer — conversationally, autonomously, and with zero manual swaps.

[![X Layer Mainnet](https://img.shields.io/badge/X%20Layer-Mainnet%20(196)-orange)](https://www.okx.com/xlayer)
[![OKX Onchain OS](https://img.shields.io/badge/OKX%20Onchain%20OS-8%20Skills-blue)](https://web3.okx.com/onchain-os)
[![Built for OKX Build X Hackathon](https://img.shields.io/badge/OKX%20Build%20X-Hackathon%202026-green)](https://dorahacks.io/hackathon/okx-xlayer/detail)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 What It Does

You have $0.20 of WOKB, $1.50 of some token, and $0.80 of another sitting idle in your wallet — worthless individually for buying anything, but together covering a $2.00 paywall. **ZeroWaste Protocol eliminates that waste.**

Just tell the bot what you want to pay for. In plain English. It handles everything else.

```
You:  "pay for this article: http://content.xyz/premium-story"
Bot:  💬 Got it, checking that paywall for you!
      🔗 Checking paywall at: http://content.xyz/premium-story
      ⚠️ x402 Payment Required — $0.12 USDT
      🔍 Scanning your dust...  2 safe tokens, $0.26 total
      📊 WOKB live price: $0.2484 (DEX-validated)
      💱 Proposed: Sweep 0.00145 WOKB → $0.12 USDT → pay merchant
      [✅ Approve & Pay]  [❌ Cancel]
  → User taps Approve
      ✅ Swap confirmed (OKX Gateway — block 57495189)
      ✅ Merchant paid (OKX Gateway — block 57495194)
      🎉 Access unlocked! Here's your content...
```

---

## 🏗️ Architecture

![ZeroWaste Protocol Architecture](docs/architecture.svg)

### System Layers

| Layer | Components |
|---|---|
| **User Interface** | Telegram Bot with inline keyboards |
| **AI Layer** | Groq LLaMA 3.3 70B — Natural language intent parsing |
| **Core Services** | WalletScanner · TxSimulator · TokenEnricher · SwapRouter |
| **Execution** | OKX Agentic Wallet (onchainos CLI) · OKX Gateway tracking |
| **Blockchain** | X Layer Mainnet (Chain ID: 196) |

---

## 🔧 OKX Onchain OS Skills (8 Integrated)

| Skill | Integration | What It Does |
|---|---|---|
| `okx-agentic-wallet` | `AgenticWallet.ts` | TEE-secured agent wallet per user — signs every tx via onchainos CLI with mutex protection |
| `okx-wallet-portfolio` | `WalletScanner.ts` | Scans agent wallet for dust tokens on X Layer via OKX Portfolio API |
| `okx-dex-swap` | `SwapRouter.ts` | Computes optimal swap routes (dust → USDT) via OKX DEX Aggregator V6 across 500+ DEX sources |
| `okx-dex-token` | `TokenEnricher.ts` | Enriches dust token prices with live DEX quotes before basket selection for real-time accuracy |
| `okx-x402-payment` | `bot/index.ts` | Handles HTTP 402 payment protocol — detects paywalls, parses payment requirements |
| `okx-onchain-gateway` | `PaymentVerifier.ts` | Tracks transaction status post-broadcast via OKX Gateway API (`transaction-detail-by-txhash`) |
| `okx-security` | `TxSimulator.ts` | Pre-filters risk tokens from dust basket; validates txs via OKX pre-transaction API |
| `okx-audit-log` | `AuditLog.ts` | Queries on-chain transaction history for the `/history` command — immutable payment audit trail |

---

## 🔄 Payment Flow — Sequence Diagrams

### Scenario 1: Direct USDT Payment (Fast Path)

```mermaid
sequenceDiagram
    actor User
    participant Bot as ZeroWaste Bot
    participant Groq as Groq LLaMA 3.3
    participant Merchant as x402 Merchant
    participant Chain as X Layer Mainnet

    User->>Bot: "pay for this: http://..."
    Bot->>Groq: parse intent
    Groq-->>Bot: {type: "pay_url", url: "..."}
    Bot->>Merchant: GET /premium-article
    Merchant-->>Bot: 402 + {amount: "0.12 USDT", recipient: "0x2fBa..."}
    Bot->>Bot: scan dust — USDT balance ≥ required
    Bot-->>User: 💬 Propose direct USDT payment
    User->>Bot: ✅ Approve
    Bot->>Chain: transfer USDT → merchant
    Chain-->>Bot: tx confirmed (OKX Gateway)
    Bot->>Merchant: retry GET /premium-article
    Merchant-->>Bot: 200 + content
    Bot-->>User: 🎉 Access unlocked!
```

### Scenario 2: Single-Token Dust Sweep (Core Flow)

```mermaid
sequenceDiagram
    actor User
    participant Bot as ZeroWaste Bot
    participant OKXPortfolio as OKX Portfolio API
    participant OKXSecurity as OKX Security API
    participant OKXToken as OKX DEX Token API
    participant OKXSwap as OKX DEX Swap API
    participant Wallet as OKX Agentic Wallet
    participant Gateway as OKX Gateway API
    participant Chain as X Layer Mainnet

    User->>Bot: "pay for this: http://..."
    Bot->>OKXPortfolio: scan dust tokens
    OKXPortfolio-->>Bot: [WOKB: 0.0044, ~$0.37]
    Bot->>OKXSecurity: filter risk tokens
    OKXSecurity-->>Bot: [WOKB: ✅ safe]
    Bot->>OKXToken: enrich with live DEX prices
    OKXToken-->>Bot: WOKB: $0.2484 (DEX quote)
    Bot->>OKXSwap: get WOKB→USDT route
    OKXSwap-->>Bot: swap calldata + approve calldata
    Bot-->>User: 💬 Propose: sweep WOKB → $0.12 USDT
    User->>Bot: ✅ Approve
    Bot->>Wallet: onchainos approve WOKB
    Wallet->>Chain: approve tx
    Bot->>Gateway: track approve tx
    Gateway-->>Bot: ✅ confirmed block N
    Bot->>Wallet: onchainos execute swap
    Wallet->>Chain: swap tx
    Bot->>Gateway: track swap tx
    Gateway-->>Bot: ✅ confirmed block N
    Bot->>Wallet: transfer USDT → merchant
    Wallet->>Chain: transfer tx
    Bot->>Gateway: track payment tx
    Gateway-->>Bot: ✅ confirmed block N
    Bot-->>User: 🎉 Paid & unlocked!
```

### Scenario 3: Multi-Token Basket Sweep

```mermaid
sequenceDiagram
    actor User
    participant Bot as ZeroWaste Bot
    participant Scanner as WalletScanner
    participant Router as SwapRouter
    participant Chain as X Layer Mainnet

    User->>Bot: paste paywalled URL ($2.00)
    Bot->>Scanner: scan dust
    Scanner-->>Bot: [TokenA: $0.80, TokenB: $1.50, TokenC: $0.30]
    Bot->>Bot: selectDustBasket(target=$2.00, slippage=5%)
    Bot->>Router: compute routes for [TokenA, TokenB] in parallel
    Router-->>Bot: [route_A, route_B]
    Bot-->>User: 💬 Propose: sweep TokenA + TokenB → $2.10 USDT
    User->>Bot: ✅ Approve
    loop For each token in basket
        Bot->>Chain: approve token for DEX
        Bot->>Chain: swap token → USDT
    end
    Bot->>Chain: transfer $2.00 USDT → merchant
    Bot-->>User: 🎉 Paid with combined dust!
```

---

## 📄 Smart Contract

### `DustSweeperMulticall.sol`

Deployed on **X Layer Mainnet** (Chain ID: 196).

**Address:** [`0x1E52781EC86C99C972f30366dA493c780a54ED8c`](https://www.okx.com/web3/explorer/xlayer/address/0x1E52781EC86C99C972f30366dA493c780a54ED8c)

Provides an **atomic fallback path**: executes all swap calls in a single transaction, verifies total USDT output meets the x402 requirement, then forwards payment. If any swap produces insufficient USDT, the **entire transaction reverts** — protecting user tokens.

---

## 🤖 Bot Commands

| Command | Description |
|---|---|
| `/start` | Create your TEE-secured agent wallet |
| `/wallet` | View your agent wallet address + explorer link |
| `/dust` | Scan your agent wallet for dust tokens |
| `/setdust <amount>` | Set your personal dust threshold (e.g. `/setdust 5`) |
| `/history` | View your on-chain sweep payment history (audit log) |
| `/help` | Show all commands |
| _paste any URL_ | Detect paywall and initiate sweep payment |
| _natural language_ | "pay for this article [URL]", "how much dust do I have?" |

---

## 🚀 Setup & Run

### Prerequisites

- Node.js 18+
- [Telegram Bot Token](https://t.me/BotFather)
- [OKX API credentials](https://web3.okx.com/onchain-os/dev-portal) with `OK-ACCESS-PROJECT`
- [Groq API key](https://console.groq.com/keys) (for natural language parsing)
- OKB on X Layer for gas

### Installation

```bash
git clone https://github.com/Raksha001/ZeroWaste-Protocol.git
cd ZeroWaste-Protocol
npm install
```

### Configuration

```bash
cp .env.example .env
# Fill in your credentials:
# TELEGRAM_BOT_TOKEN=...
# OKX_API_KEY=...
# OKX_SECRET_KEY=...
# OKX_PASSPHRASE=...
# OKX_PROJECT_ID=...
# GROQ_API_KEY=...
# NETWORK=mainnet
```

### Run

```bash
# Start everything (merchant + bot)
npm run dev

# Or separately:
npm run start:merchant   # Mock x402 paywall server on :3001
npm run start:bot        # Telegram bot
```

### Test the Full Flow

```bash
# In Telegram, send to your bot:
http://localhost:3001/premium-article   # $0.12 paywall
http://localhost:3001/premium-news      # $0.30 paywall
http://localhost:3001/api-access        # $2.00 paywall
```

---

## 🏆 Hackathon Prize Alignment

| Prize Category | How ZeroWaste Protocol Qualifies |
|---|---|
| **Best x402 Application** | Complete end-to-end x402 implementation: paywall detection → payment → content unlock on X Layer Mainnet |
| **Most Active Agent** | Autonomous agent executes 3 on-chain transactions per payment (approve + swap + transfer) with real mainnet tx hashes |
| **Best MCP Integration** | onchainos CLI as the agentic wallet backbone; 8 OKX Onchain OS skills integrated |
| **Best Economy Loop** | Dust tokens (idle value) → USDT (active value) → merchant revenue → content access — a complete circular economy |

---

## 🔑 Key Design Decisions

- **OKX DEX Aggregator over raw DEX** — Better fill rates for small/illiquid dust token swaps on X Layer
- **Sequential approve → swap** over atomic multicall for primary path — more reliable with varied ERC20 approvals
- **WOKB as primary test token** — Native-wrapped OKB has deep liquidity guaranteeing DEX routing success
- **5% slippage buffer** in basket selection — accounts for price movement between quote and execution
- **Groq LLaMA 3.3 70B** — Fastest inference available, critical for a responsive Telegram bot feel
- **Mutex-protected wallet switching** — Prevents concurrent onchainos account conflicts for multi-user scenarios

---

## 📁 Project Structure

```
src/
├── bot/
│   └── index.ts              # Main bot logic, all command handlers
├── services/
│   ├── AgenticWallet.ts      # onchainos CLI wrapper (okx-agentic-wallet)
│   ├── WalletScanner.ts      # Dust token discovery (okx-wallet-portfolio)
│   ├── SwapRouter.ts         # DEX route computation (okx-dex-swap)
│   ├── TokenEnricher.ts      # Live price enrichment (okx-dex-token)
│   ├── TxSimulator.ts        # Risk filter + tx simulation (okx-security)
│   ├── PaymentVerifier.ts    # Tx confirmation (okx-onchain-gateway)
│   ├── AuditLog.ts           # Transaction history (okx-audit-log)
│   ├── IntentParser.ts       # Groq LLM intent parsing
│   ├── OkxApiClient.ts       # HMAC-authenticated OKX API client
│   └── UserWalletStore.ts    # Persistent user wallet + preferences
├── merchant/
│   └── server.ts             # Mock x402 paywall server
├── scripts/                  # Setup & funding utilities
└── config/
    └── network.ts            # X Layer mainnet/testnet config
contracts/
└── DustSweeperMulticall.sol  # Atomic multicall fallback contract
docs/
└── architecture.png          # System architecture diagram
```

---

## 👥 Team

| Name | Role |
|---|---|
| Sharwin | Full-stack development & architecture |

---

## 📜 License

MIT
