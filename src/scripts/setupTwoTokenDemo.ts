/**
 * Sets up the two-token sweep demo:
 * 1. Swaps 200000 raw USDT ($0.20) → USDC on the user's agent wallet
 * 2. Clears remaining USDT back to deployer so direct-payment path can't trigger
 *
 * Result: User wallet has USDC (~$0.20) + WOKB (~$0.17), no USDT
 * Demo paywall at $0.30 → neither token alone is enough, but combined they are
 *
 * Run: npx ts-node -r dotenv/config src/scripts/setupTwoTokenDemo.ts
 */
import { exec } from "child_process";
import { promisify } from "util";
import { okxApi } from "../services/OkxApiClient";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const ONCHAINOS = process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

const CHAIN_ID = "196"; // X Layer Mainnet
const USER_ACCOUNT_ID = "813cd27d-e213-47e5-92f5-c29f905e2531";
const USER_WALLET = "0x2b74f006480c58781c886c2a2b5c03d8bceb2a12";
const DEPLOYER = "0x2fBa2c09bD34Cc638faf30e98D88f354aC47A09F";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY!;
const RPC = "https://okx-xlayer.rpc.blxrbdn.com";

const USDT = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const USDC = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";

const SWAP_AMOUNT_RAW = "200000"; // 0.20 USDT (6 decimals)

async function run() {
  console.log("=== Two-Token Demo Setup ===\n");

  // ——— Step 1: Switch to user account ———
  console.log("1. Switching to user account...");
  await execAsync(`${ONCHAINOS} wallet switch ${USER_ACCOUNT_ID}`);
  console.log("   ✅ Switched\n");

  // ——— Step 2: Get swap route USDT → USDC ———
  console.log(`2. Fetching OKX DEX swap route: ${SWAP_AMOUNT_RAW} raw USDT → USDC...`);
  const swapResp = await okxApi.get("/api/v6/dex/aggregator/swap", {
    chainIndex: CHAIN_ID,
    fromTokenAddress: USDT,
    toTokenAddress: USDC,
    amount: SWAP_AMOUNT_RAW,
    slippagePercent: "5.0",
    userWalletAddress: USER_WALLET,
  });

  if (swapResp.code !== "0" || !swapResp.data?.[0]) {
    console.error("   ❌ OKX DEX API error:", JSON.stringify(swapResp, null, 2));
    process.exit(1);
  }

  const route = swapResp.data[0];
  const expectedUsdc = parseFloat(route.routerResult?.toTokenAmount || "0") / 1e6;
  console.log(`   ✅ Route found: expected output ~$${expectedUsdc.toFixed(4)} USDC`);
  console.log(`   Router: ${route.tx.to}\n`);

  // ——— Step 3: Approve USDT for the DEX router ———
  console.log("3. Fetching approval calldata...");
  const approveResp = await okxApi.get("/api/v6/dex/aggregator/approve-transaction", {
    chainIndex: CHAIN_ID,
    tokenContractAddress: USDT,
    approveAmount: SWAP_AMOUNT_RAW,
  });

  if (approveResp.code === "0" && approveResp.data?.[0]) {
    console.log("   Sending approve tx...");
    const approveCmd = `${ONCHAINOS} wallet contract-call --to ${USDT} --chain ${CHAIN_ID} --input-data ${approveResp.data[0].data} --force`;
    const { stdout: approveOut } = await execAsync(approveCmd);
    const approveParsed = JSON.parse(approveOut.trim());
    if (approveParsed.ok) {
      console.log(`   ✅ Approved: ${approveParsed.data?.txHash}\n`);
    } else {
      console.error("   ❌ Approve failed:", approveOut);
      process.exit(1);
    }
  } else {
    console.log("   ℹ️  No approval needed\n");
  }

  // ——— Step 4: Execute the swap ———
  console.log("4. Executing USDT → USDC swap...");
  const swapCmd = `${ONCHAINOS} wallet contract-call --to ${route.tx.to} --chain ${CHAIN_ID} --input-data ${route.tx.data} --force`;
  const { stdout: swapOut } = await execAsync(swapCmd);
  let swapParsed: any;
  try {
    swapParsed = JSON.parse(swapOut.trim());
  } catch {
    console.error("   ❌ Could not parse swap output:", swapOut);
    process.exit(1);
  }
  if (!swapParsed.ok) {
    console.error("   ❌ Swap failed:", JSON.stringify(swapParsed));
    process.exit(1);
  }
  console.log(`   ✅ Swap tx: ${swapParsed.data?.txHash}\n`);

  // ——— Step 5: Clear remaining USDT back to deployer ———
  console.log("5. Clearing remaining USDT to deployer so direct-pay can't trigger...");

  // Check actual USDT balance after swap
  await new Promise((r) => setTimeout(r, 3000)); // wait for chain state
  const { stdout: balOut } = await execAsync(
    `cast call ${USDT} "balanceOf(address)(uint256)" ${USER_WALLET} --rpc-url ${RPC}`
  );
  const remainingUsdt = balOut.trim().split(" ")[0];
  console.log(`   Remaining USDT raw: ${remainingUsdt}`);

  if (BigInt(remainingUsdt) > 0n) {
    // encode transfer(deployer, amount)
    const { stdout: transferData } = await execAsync(
      `cast calldata "transfer(address,uint256)" ${DEPLOYER} ${remainingUsdt}`
    );
    const clearCmd = `${ONCHAINOS} wallet contract-call --to ${USDT} --chain ${CHAIN_ID} --input-data ${transferData.trim()} --force`;
    const { stdout: clearOut } = await execAsync(clearCmd);
    const clearParsed = JSON.parse(clearOut.trim());
    if (clearParsed.ok) {
      console.log(`   ✅ Cleared USDT: ${clearParsed.data?.txHash}\n`);
    } else {
      console.error("   ❌ Clear failed:", clearOut);
    }
  } else {
    console.log("   ℹ️  No remaining USDT to clear\n");
  }

  console.log("=== Setup complete! ===");
  console.log("User wallet now has:");
  console.log("  • USDT: $0.00 (cleared)");
  console.log(`  • USDC: ~$${expectedUsdc.toFixed(2)} (from swap)`);
  console.log("  • WOKB: ~$0.17 (unchanged)");
  console.log("\nTest: paste http://localhost:3001/premium-news in Telegram");
  console.log("Bot should sweep USDC + WOKB via DEX to pay the $0.30 price");
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
