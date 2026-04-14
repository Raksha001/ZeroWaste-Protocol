# Smart-Sweep Checkout v2: Architecture

## System Overview

A Telegram-based agentic payment bot that fulfills x402 paywalls by liquidating wallet "dust" tokens on X Layer.

## Component Map

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Telegram   │────▶│   Agent Core     │────▶│   X Layer (196)    │
│  Bot (UI)   │     │   (Node.js)      │     │   Mainnet          │
│             │◀────│                  │◀────│                    │
└─────────────┘     └──────┬───┬───┬───┘     └────────────────────┘
                           │   │   │
              ┌────────────┘   │   └────────────┐
              ▼                ▼                ▼
     ┌────────────────┐ ┌──────────┐ ┌──────────────────┐
     │ WalletScanner  │ │SwapRouter│ │ PaymentVerifier   │
     │                │ │          │ │                    │
     │ okx-wallet-    │ │ okx-dex- │ │ ethers.js          │
     │ portfolio API  │ │ swap API │ │ + RPC              │
     └────────────────┘ └──────────┘ └──────────────────┘
```

## Execution Flow

### Phase 1: Trigger
- User pastes a URL in Telegram → Bot receives text message

### Phase 2: Reconnaissance (Off-chain)
1. Bot GETs the URL → Mock merchant returns HTTP 402 + x402 JSON
2. Bot extracts: price ($5 USDT), merchant address, target token (USDT)
3. Bot calls OKX Wallet Portfolio API → gets user's X Layer token balances
4. Filters for "dust" (tokens valued < $5)
5. Selects optimal basket of dust tokens ≥ $5 + 5% slippage buffer
6. Bot calls OKX DEX Aggregator API for each dust token → gets swap calldata
7. All routing computed in parallel via `Promise.all`

### Phase 3: Proposal & Authorization
- Bot formats a Telegram message showing the exact dust breakdown
- Shows estimated output per token and total USDT output
- Provides inline button: [🟢 Approve & Pay with Dust]

### Phase 4: On-chain Execution
- For each dust token:
  1. Approve token spend to DEX router
  2. Execute swap (dust → USDT)
- Final step: Transfer exact USDT amount to merchant address

### Phase 5: Fulfillment
- Bot listens for tx confirmation on X Layer
- Calls merchant's `/confirm-payment` endpoint with tx hash
- Merchant unlocks content
- Bot shows ✅ confirmation + content link to user

## Design Decisions

### OKX DEX Aggregator vs Raw Uniswap SOR
We use the OKX DEX Aggregator (`okx-dex-swap`) because:
- Routes through Uniswap + 500 other DEX sources on X Layer
- Better fill rates for small/illiquid dust token swaps
- Returns ready-to-sign tx data (no manual calldata encoding)
- Counts as a core Onchain OS skill for hackathon scoring

### Sequential vs Atomic Execution
Primary flow uses sequential approve→swap per token because:
- More reliable with varied token approval patterns
- Easier to debug and monitor per-token outcomes
- `DustSweeperMulticall.sol` remains available as atomic fallback
