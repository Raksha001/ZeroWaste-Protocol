# Smart-Sweep Checkout: Testing Guide

## 1. Local Testing Strategy

Developing a multi-protocol agent for X Layer requires mocking out external APIs to avoid rate limits, avoid unnecessary gas fees, and enable rapid reliable iteration. 

## 2. Mocking the Services

### Mocking Onchain OS API (`WalletScanner`)
Since we cannot rely on a live wallet constantly changing its dust properties during testing:
- Configure a `MockWalletScanner` interface in development.
- The mock will return a deterministic response replicating the Onchain OS portfolio structure.
- **Mock Scenario:** Supply a JSON fixture containing 3 "dust" tokens (MockTokenA valued at $2, MockTokenB valued at $4, MockTokenC valued at $5) on X Layer.

### Mocking Uniswap SOR (`SwapRouter`)
The Uniswap Smart Order Router requires valid live liquidity data and can be slow if excessively queried locally.
- Implement an environment toggle (e.g., `MOCK_UNISWAP=true`).
- When active, `SwapRouter` bypasses the actual HTTPS request and returns hardcoded, validly encoded ABI `calldata` representing a generic successful swap to the target stablecoin.

## 3. Smart Contract Verification (Foundry/Hardhat)
Testing the `DustSweeperMulticall` contract is arguably the most critical aspect to assure funds are safe.

**Test Setup:**
1. Best approach is to leverage Hardhat or Foundry to **Fork X Layer Mainnet**. This allows tests to interact with the real Uniswap Router and actual liquidity pools without spending real funds.
2. If forking is too slow for CI, deploy a mock ERC20 environment alongside a mock AMM Router.

**Test Cases Required:**
- **Success Case:** Supply 3 dust tokens. Simulate swaps yielding $10.50 USDT. Contract correctly sends $10.00 USDT to merchant and refunds the remaining $0.50 USDT back to the user.
- **Strict Revert Case (Slippage/Price Drop):** Supply dust tokens. Simulate swaps yielding only $9.80 USDT. Ensure the entire transaction `reverts` because the $10.00 USDT target was not met.
- **Gas Profiling:** Determine the gas overhead of wrapping 3-4 swaps + transfer logic inside a single transaction to ensure it remains economical on X Layer.
