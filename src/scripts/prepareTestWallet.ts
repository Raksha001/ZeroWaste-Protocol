import { WalletScanner, TokenAsset } from "../services/WalletScanner";
import { SwapRouter } from "../services/SwapRouter";
import { AgenticWallet } from "../services/AgenticWallet";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

/**
 * prepareTestWallet.ts
 * 
 * Liquidates surplus USDC, WETH, and USDT into WOKB 
 * to achieve the following target state for the test scenario:
 * 
 * - USDC: $0.08
 * - WETH: $0.05
 * - USDT: $0.005
 * 
 * Destination for surplus: WOKB (0xe538905cf8410324e03a5a23c1c177a474d59b2b)
 */

const TARGET_WALLET = process.env.AGENT_WALLET_ADDRESS || "";

const TARGET_CONFIGS = [
  {
    symbol: "USDC",
    address: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
    targetUsd: 0.08,
  },
  {
    symbol: "WETH",
    address: "0x5a77f1443d16ee5761d310e38b7308067ea468b9",
    targetUsd: 0.05,
  },
  {
    symbol: "USDT",
    address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d",
    targetUsd: 0.005,
  }
];

const DESTINATION_TOKEN = "0xe538905cf8410324e03a5a23c1c177a474d59b2b"; // WOKB

async function prepare() {
  if (!TARGET_WALLET) {
    console.error("❌ AGENT_WALLET_ADDRESS not set in .env");
    process.exit(1);
  }

  console.log(`🧹 Preparing test wallet: ${TARGET_WALLET}`);
  console.log(`🛠️ Mode: LIVE (X Layer Mainnet)`);

  try {
    const dustTokens = await WalletScanner.getDustTokens(TARGET_WALLET);
    
    for (const config of TARGET_CONFIGS) {
      const token = dustTokens.find(t => t.tokenAddress.toLowerCase() === config.address.toLowerCase());
      
      if (!token) {
        console.log(`⚠️  Token ${config.symbol} not found in wallet. Skipping...`);
        continue;
      }

      const currentUsd = token.usdValue;
      if (currentUsd <= config.targetUsd) {
        console.log(`✅ ${config.symbol} balance ($${currentUsd.toFixed(3)}) is already at or below target ($${config.targetUsd}).`);
        continue;
      }

      const surplusUsd = currentUsd - config.targetUsd;
      const surplusAmountFloat = surplusUsd / parseFloat(token.tokenPrice);
      const surplusRaw = ethers.parseUnits(surplusAmountFloat.toFixed(token.decimals), token.decimals).toString();

      console.log(`\n🔄 Liquidating surplus ${config.symbol}:`);
      console.log(`   - Current: $${currentUsd.toFixed(3)}`);
      console.log(`   - Target:  $${config.targetUsd.toFixed(3)}`);
      console.log(`   - Surplus: $${surplusUsd.toFixed(3)} (~${surplusAmountFloat.toFixed(6)} ${config.symbol})`);

      // 1. Get Route
      const route = await SwapRouter.getSwapRoute(token, TARGET_WALLET, DESTINATION_TOKEN, surplusRaw);
      
      console.log(`   - Estimated WOKB output: $${route.estimatedOutputUsd} USD`);

      // 2. Approve if needed
      if (route.approveData) {
        console.log(`   - Sending Approval...`);
        const approveTx = await AgenticWallet.sendTransaction(route.approveData.to, route.approveData.data);
        console.log(`   - Approve Tx: ${approveTx}`);
        await new Promise(r => setTimeout(r, 5000)); // Wait for inclusion
      }

      // 3. Swap
      console.log(`   - Sending Swap...`);
      const swapTx = await AgenticWallet.sendTransaction(route.txData.to, route.txData.data, route.txData.value);
      console.log(`   - Swap Tx: ${swapTx}`);
      
      console.log(`✅ ${config.symbol} surplus liquidated.`);
    }

    console.log(`\n🎉 Wallet preparation complete!`);
  } catch (err: any) {
    console.error(`\n❌ Error during preparation:`, err.message);
  }
}

prepare();
