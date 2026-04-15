import dotenv from "dotenv";

dotenv.config();

/**
 * Centralized network configuration.
 * Switch between testnet and mainnet using the NETWORK env var.
 *
 * NETWORK=testnet  → X Layer Testnet (Chain ID 195) — free gas via faucet
 * NETWORK=mainnet  → X Layer Mainnet (Chain ID 196) — real OKB gas
 *
 * Same private key & wallet address works on BOTH networks.
 */

const NETWORK = process.env.NETWORK || "testnet";
const isTestnet = NETWORK === "testnet";

// X Layer Testnet: https://testrpc.xlayer.tech  (Chain ID 195)
// X Layer Mainnet: https://rpc.xlayer.tech      (Chain ID 196)
export const networkConfig = {
  isTestnet,
  networkName: isTestnet ? "X Layer Testnet" : "X Layer Mainnet",

  rpcUrl: isTestnet
    ? process.env.XLAYER_TESTNET_RPC_URL || "https://testrpc.xlayer.tech"
    : process.env.XLAYER_MAINNET_RPC_URL || "https://rpc.xlayer.tech",

  chainId: isTestnet ? 195 : 196,

  // OKX DEX API chain index (same for both testnet and mainnet — OKX routes to correct network via chainId)
  chainIndex: "196",

  // USDT contract on X Layer
  // NOTE: On testnet use a faucet-issued test USDT, or test with any ERC20
  usdtAddress: isTestnet
    ? "0x3fd506b2e2b0b98b7b4d08b49d6af2b49c4e099"   // Test USDT on X Layer Testnet (placeholder — verify on explorer)
    : "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",  // USDT on X Layer Mainnet

  dustSweeperContract: process.env.DUST_SWEEPER_CONTRACT || "",

  // OKX DEX Aggregator router on X Layer (consistent across token pairs)
  okxDexRouter: "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954",

  explorerUrl: isTestnet
    ? "https://www.okx.com/web3/explorer/xlayer-test"
    : "https://www.okx.com/web3/explorer/xlayer",

  faucetUrl: "https://www.okx.com/xlayer/faucet",
} as const;

export type NetworkConfig = typeof networkConfig;

// Log network on startup
console.log(`\n⛓️  Network: ${networkConfig.networkName} (Chain ID: ${networkConfig.chainId})`);
console.log(`   RPC: ${networkConfig.rpcUrl}`);
if (isTestnet) {
  console.log(`   💧 Need gas? Visit: ${networkConfig.faucetUrl}\n`);
} else {
  console.log(`   ⚠️  MAINNET — real transactions\n`);
}
