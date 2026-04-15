/**
 * prepareAgentForSingleTokenTest.ts
 *
 * Prepares the agent wallet for Scenario 3 (single token sweep):
 *
 *   BEFORE: agent has $0.214 USDT → bot fires direct-pay fast path (boring)
 *   AFTER:  agent has ~$0 USDT + ~$0.25 USDC → bot must swap USDC → USDT → pay merchant
 *
 * Steps:
 *   1. Read agent's current USDT balance
 *   2. Transfer all USDT from agent → deployer (onchainos CLI)
 *   3. Fetch OKB → USDC swap calldata from OKX DEX API (from agent wallet, ~0.003 OKB)
 *   4. Execute the swap via onchainos CLI (with native OKB value)
 *   5. Print final balances
 *
 * Run:  npx tsx src/scripts/prepareAgentForSingleTokenTest.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { AgenticWallet } from "../services/AgenticWallet";
import { PaymentVerifier } from "../services/PaymentVerifier";
import { okxApi } from "../services/OkxApiClient";
import { networkConfig } from "../config/network";

// ── Addresses ────────────────────────────────────────────────
const AGENT_ACCOUNT_ID = "813cd27d-e213-47e5-92f5-c29f905e2531";
const AGENT_ADDRESS    = "0x2b74f006480c58781c886c2a2b5c03d8bceb2a12";
const DEPLOYER         = "0x2fBa2c09bD34Cc638faf30e98D88f354aC47A09F";

const USDT  = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";   // 6 dec
const USDC  = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";   // 6 dec
const WOKB  = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";   // 18 dec
const NATIVE_OKB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// How much of the agent's OKB to swap → USDC.
// 0.003 OKB ≈ $0.25 at ~$84/OKB — comfortably covers the $0.12/$0.30 paywalls
const SWAP_OKB_AMOUNT_ETH = "0.003"; // human-readable
const SWAP_OKB_AMOUNT_WEI = ethers.parseEther(SWAP_OKB_AMOUNT_ETH).toString();

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const verifier = new PaymentVerifier();

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function printBalances(label: string, provider: ethers.Provider) {
  const tokens = [
    { sym: "USDT", addr: USDT, dec: 6  },
    { sym: "USDC", addr: USDC, dec: 6  },
    { sym: "WOKB", addr: WOKB, dec: 18 },
  ];
  const entries: string[] = [];
  for (const { sym, addr, dec } of tokens) {
    const c = new ethers.Contract(addr, ERC20_ABI, provider);
    const b = await c.balanceOf(AGENT_ADDRESS);
    if (b > 0n) entries.push(`${sym}: ${ethers.formatUnits(b, dec)}`);
  }
  const okb = await provider.getBalance(AGENT_ADDRESS);
  entries.unshift(`OKB: ${ethers.formatEther(okb)}`);
  console.log(`\n  [${label}] Agent wallet:`);
  entries.forEach(e => console.log(`    • ${e}`));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

  console.log("\n🔧 Preparing agent wallet for single-token sweep test");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Agent:    ${AGENT_ADDRESS}`);
  console.log(`  Account:  ${AGENT_ACCOUNT_ID}`);

  await printBalances("BEFORE", provider);

  // ── Read current USDT balance ──────────────────────────────────────────────
  const usdtContract = new ethers.Contract(USDT, ERC20_ABI, provider);
  const agentUsdt = await usdtContract.balanceOf(AGENT_ADDRESS);

  if (agentUsdt === 0n) {
    console.log("\n  ✅ Agent already has 0 USDT — skipping drain step.");
  } else {
    const usdtHuman = ethers.formatUnits(agentUsdt, 6);
    console.log(`\n  Step 1/2 — Draining ${usdtHuman} USDT from agent → deployer...`);

    // Encode transfer(deployer, fullBalance)
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    const calldata = iface.encodeFunctionData("transfer", [DEPLOYER, agentUsdt]);

    const drainTxHash = await AgenticWallet.sendTransactionForUser(
      AGENT_ACCOUNT_ID,
      USDT,        // call the USDT contract
      calldata
    );
    console.log(`  ⏳ Drain tx: ${drainTxHash}`);
    await verifier.waitForConfirmation(drainTxHash, 60000);
    console.log(`  ✅ USDT drained to deployer.`);
    await sleep(2000);
  }

  // ── Check OKB balance ──────────────────────────────────────────────────────
  const okbBalance = await provider.getBalance(AGENT_ADDRESS);
  const okbFloat = parseFloat(ethers.formatEther(okbBalance));
  console.log(`\n  Agent OKB balance: ${okbFloat.toFixed(8)}`);

  // Need SWAP_OKB + gas for swap tx (~0.001 OKB) + gas for later bot txs (~0.002 OKB)
  const minOkbRequired = parseFloat(SWAP_OKB_AMOUNT_ETH) + 0.002;
  if (okbFloat < minOkbRequired) {
    // Reduce swap amount to leave enough gas
    const safeSwapOkb = Math.max(okbFloat - 0.002, 0.0005);
    if (safeSwapOkb < 0.001) {
      console.error(`\n  ❌ Agent only has ${okbFloat.toFixed(8)} OKB — not enough for swap + gas.`);
      console.error(`     Please top up agent wallet with ~0.01 OKB and retry.`);
      process.exitCode = 1;
      return;
    }
    console.warn(`  ⚠️  Low OKB — reducing swap amount to ${safeSwapOkb.toFixed(6)} OKB (keeping 0.002 for bot gas)`);
    // Re-derive swap amount
    (global as any).__swapOkbWei = ethers.parseEther(safeSwapOkb.toFixed(18)).toString();
  } else {
    (global as any).__swapOkbWei = SWAP_OKB_AMOUNT_WEI;
  }
  const swapWei: string = (global as any).__swapOkbWei;
  const swapEth = ethers.formatEther(swapWei);

  // ── Get OKB → USDC swap calldata from OKX DEX ─────────────────────────────
  console.log(`\n  Step 2/2 — Fetching OKB → USDC swap route (${swapEth} OKB from agent)...`);
  await sleep(1000);

  let swapData: any;
  try {
    swapData = await okxApi.get("/api/v6/dex/aggregator/swap", {
      chainIndex:        networkConfig.chainId.toString(),
      fromTokenAddress:  NATIVE_OKB,
      toTokenAddress:    USDC,
      amount:            swapWei,
      slippagePercent:   "2",
      userWalletAddress: AGENT_ADDRESS,
    });
  } catch (e: any) {
    console.error("  ❌ OKX DEX API error:", e.response?.data || e.message);
    process.exitCode = 1;
    return;
  }

  if (swapData.code !== "0" || !swapData.data?.[0]) {
    console.error("  ❌ OKX DEX swap quote failed:", swapData.msg || JSON.stringify(swapData));
    process.exitCode = 1;
    return;
  }

  const route = swapData.data[0];
  const expectedUsdc = (parseFloat(route.routerResult?.toTokenAmount || "0") / 1e6).toFixed(6);
  console.log(`  ✅ Route found. Expected: ~${expectedUsdc} USDC`);
  console.log(`     DEX router: ${route.tx.to}`);

  // Execute swap via onchainos CLI (--amt carries the native OKB value)
  console.log(`  📤 Executing swap via onchainos...`);
  const swapTxHash = await AgenticWallet.sendTransactionForUser(
    AGENT_ACCOUNT_ID,
    route.tx.to,    // OKX DEX router
    route.tx.data,
    swapWei         // native OKB value (goes as --amt flag)
  );
  console.log(`  ⏳ Swap tx: ${swapTxHash}`);
  await verifier.waitForConfirmation(swapTxHash, 90000);
  console.log(`  ✅ Swap confirmed!`);
  await sleep(2000);

  // ── Final balances ─────────────────────────────────────────────────────────
  await printBalances("AFTER", provider);

  // Check USDC balance
  const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider);
  const finalUsdc = await usdcContract.balanceOf(AGENT_ADDRESS);
  const finalUsdcHuman = parseFloat(ethers.formatUnits(finalUsdc, 6));
  const finalUsdt = await usdtContract.balanceOf(AGENT_ADDRESS);
  const finalUsdtHuman = parseFloat(ethers.formatUnits(finalUsdt, 6));

  console.log("\n══════════════════════════════════════════════════");
  console.log("  ✅ Agent wallet is ready for single-token test!");
  console.log(`     USDT: $${finalUsdtHuman.toFixed(6)} (should be ~$0)`);
  console.log(`     USDC: $${finalUsdcHuman.toFixed(6)} (this will be swapped → USDT)`);
  console.log("\n  📋 Now test in Telegram:");
  console.log("     1. Send /dust — you should see USDC listed");
  console.log("     2. Paste: http://localhost:3001/premium-article  ($0.12)");
  console.log("     3. Bot will swap USDC → USDT → pay merchant");
  console.log("     Expected: 1 swap, then payment ✅");
  console.log("══════════════════════════════════════════════════\n");
}

main().catch(e => {
  console.error("\n❌ Script error:", e.message || e);
  process.exitCode = 1;
});
