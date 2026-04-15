/**
 * setupWokbForSingleTokenTest.ts
 *
 * Fixes the single-token sweep test setup:
 *   Problem: USDC (0x74b7..) has no USDT liquidity on X Layer → OKX error 82112
 *   Solution: Use WOKB (wrapped OKB) instead — it's the native token with deep liquidity
 *
 * Steps (all executed via onchainos on the agent TEE wallet):
 *   1. Wrap 0.0018 OKB → WOKB  (calls WOKB.deposit() with OKB value)
 *   2. Drain USDC → deployer    (removes the broken USDC so bot doesn't retry it)
 *
 * Result: Agent has ~$0.20 WOKB + ~$0 USDT + 0 USDC
 *   → Bot scans dust → selects WOKB → 1 swap (WOKB→USDT) → pays merchant ✅
 *
 * Run:  npx tsx src/scripts/setupWokbForSingleTokenTest.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { AgenticWallet } from "../services/AgenticWallet";
import { PaymentVerifier } from "../services/PaymentVerifier";
import { networkConfig } from "../config/network";

// ── Constants ────────────────────────────────────────────────────────────────
const AGENT_ACCOUNT_ID = "813cd27d-e213-47e5-92f5-c29f905e2531";
const AGENT_ADDRESS    = "0x2b74f006480c58781c886c2a2b5c03d8bceb2a12";
const DEPLOYER         = "0x2fBa2c09bD34Cc638faf30e98D88f354aC47A09F";

// Token addresses on X Layer Mainnet
const WOKB_ADDR = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";  // 18 dec
const USDC_ADDR = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";  // 6 dec
const USDT_ADDR = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";  // 6 dec

// How much OKB to wrap → WOKB. Keeping 0.0005 OKB for gas reserve.
// 0.0017 OKB ≈ $0.143 at $84/OKB  (plenty for $0.12 paywall with ~19% buffer)
const WRAP_OKB_WEI = ethers.parseEther("0.0017").toString();
const WRAP_OKB_ETH = "0.0017";

// WOKB ABI — only need deposit() and balanceOf
const WOKB_ABI = [
  "function deposit() external payable",
  "function balanceOf(address) view returns (uint256)",
  "function withdraw(uint256) external",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const verifier = new PaymentVerifier();

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function printAgentBalances(label: string, provider: ethers.Provider) {
  const wokb = new ethers.Contract(WOKB_ADDR, WOKB_ABI, provider);
  const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);
  const usdt = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);

  const okb  = await provider.getBalance(AGENT_ADDRESS);
  const wokbB = await wokb.balanceOf(AGENT_ADDRESS);
  const usdcB = await usdc.balanceOf(AGENT_ADDRESS);
  const usdtB = await usdt.balanceOf(AGENT_ADDRESS);

  console.log(`\n  [${label}] Agent wallet:`);
  console.log(`    OKB  : ${ethers.formatEther(okb)}`);
  if (wokbB > 0n) console.log(`    WOKB : ${ethers.formatEther(wokbB)}`);
  if (usdcB > 0n) console.log(`    USDC : ${ethers.formatUnits(usdcB, 6)}`);
  if (usdtB > 0n) console.log(`    USDT : ${ethers.formatUnits(usdtB, 6)}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

  console.log("\n🔧 Setup: WOKB for single-token sweep test");
  console.log("══════════════════════════════════════════");
  console.log(`  Agent:   ${AGENT_ADDRESS}`);
  console.log(`  Account: ${AGENT_ACCOUNT_ID}`);
  console.log(`  Why WOKB: USDC→USDT has no liquidity on X Layer (error 82112)`);
  console.log(`            WOKB is native token → deep OKB/USDT liquidity ✓`);

  await printAgentBalances("BEFORE", provider);

  // ── Sanity check OKB balance ───────────────────────────────────────────────
  const okbBalance = await provider.getBalance(AGENT_ADDRESS);
  const okbFloat = parseFloat(ethers.formatEther(okbBalance));
  const wrapFloat = parseFloat(WRAP_OKB_ETH);

  if (okbFloat < wrapFloat + 0.0002) {
    console.error(`\n  ❌ Agent only has ${okbFloat} OKB.`);
    console.error(`     Need ${wrapFloat + 0.0002} OKB (wrap + gas reserve).`);
    console.error(`     Please top up agent wallet with ~0.005 OKB and retry.`);
    process.exitCode = 1;
    return;
  }

  // ── Step 1: Wrap OKB → WOKB via WOKB.deposit() ────────────────────────────
  console.log(`\n  Step 1/2 — Wrapping ${WRAP_OKB_ETH} OKB → WOKB...`);
  console.log(`            (WOKB.deposit() is a payable function — OKB value → WOKB 1:1)`);

  // deposit() selector = keccak256("deposit()")[0:4] = 0xd0e30db0
  const depositCalldata = "0xd0e30db0";

  const wrapTxHash = await AgenticWallet.sendTransactionForUser(
    AGENT_ACCOUNT_ID,
    WOKB_ADDR,        // call the WOKB contract
    depositCalldata,  // deposit()
    WRAP_OKB_WEI      // OKB value to send (becomes WOKB 1:1)
  );
  console.log(`  ⏳ Wrap tx: ${wrapTxHash}`);
  await verifier.waitForConfirmation(wrapTxHash, 60000);
  console.log(`  ✅ OKB wrapped → WOKB!`);
  await sleep(2000);

  // ── Step 2: Drain USDC from agent → deployer ──────────────────────────────
  const usdcContract = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);
  const usdcBalance = await usdcContract.balanceOf(AGENT_ADDRESS);

  if (usdcBalance === 0n) {
    console.log(`\n  Step 2/2 — Agent has no USDC to drain. Skipping.`);
  } else {
    const usdcHuman = ethers.formatUnits(usdcBalance, 6);
    console.log(`\n  Step 2/2 — Draining ${usdcHuman} USDC from agent → deployer...`);
    console.log(`             (Removing broken token so bot doesn't retry it)`);

    const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    const calldata = iface.encodeFunctionData("transfer", [DEPLOYER, usdcBalance]);

    const drainTxHash = await AgenticWallet.sendTransactionForUser(
      AGENT_ACCOUNT_ID,
      USDC_ADDR,
      calldata
    );
    console.log(`  ⏳ Drain tx: ${drainTxHash}`);
    await verifier.waitForConfirmation(drainTxHash, 60000);
    console.log(`  ✅ USDC drained to deployer.`);
    await sleep(2000);
  }

  // ── Final state ────────────────────────────────────────────────────────────
  await printAgentBalances("AFTER", provider);

  // Read final WOKB for the summary
  const wokbContract = new ethers.Contract(WOKB_ADDR, WOKB_ABI, provider);
  const finalWokb = await wokbContract.balanceOf(AGENT_ADDRESS);
  const finalWokbUsd = parseFloat(ethers.formatEther(finalWokb)) * 84; // approx price

  console.log("\n══════════════════════════════════════════════════");
  console.log("  ✅ Agent wallet is ready for single-token test!");
  console.log(`     WOKB: ${ethers.formatEther(finalWokb)} (~$${finalWokbUsd.toFixed(3)})`);
  console.log(`     USDC: $0 (drained)`);
  console.log(`     USDT: $0`);
  console.log("\n  📋 Now test in Telegram:");
  console.log("     1. /dust  →  you should see WOKB listed");
  console.log("     2. Paste: http://localhost:3001/premium-article  ($0.12)");
  console.log("        Bot path: 1 swap WOKB→USDT → pay merchant ✅");
  console.log("     3. Or:    http://localhost:3001/premium-news      ($0.30)");
  console.log("        (only if WOKB balance ≥ $0.315 after slippage buffer)");
  console.log("══════════════════════════════════════════════════\n");
}

main().catch(e => {
  console.error("\n❌", e.message || e);
  process.exitCode = 1;
});
