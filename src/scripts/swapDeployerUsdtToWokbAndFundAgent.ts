/**
 * swapDeployerUsdtToWokbAndFundAgent.ts
 *
 * Uses the deployer's private key (EOA with USDT) to:
 *   1. Read deployer's USDT balance
 *   2. Get swap calldata from OKX DEX: USDT → WOKB
 *   3. Approve OKX DEX router to spend USDT (deployer)
 *   4. Execute the swap (deployer gets WOKB)
 *   5. Transfer ALL WOKB from deployer → agent wallet
 *
 * Result: Agent wallet has ~$0.25 WOKB for full validation flow.
 *
 * Run: npx tsx src/scripts/swapDeployerUsdtToWokbAndFundAgent.ts
 */
import "dotenv/config";
import { ethers } from "ethers";
import { okxApi } from "../services/OkxApiClient";
import { networkConfig } from "../config/network";

// ── Addresses ─────────────────────────────────────────────────
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY!;
const AGENT_ADDRESS        = "0x2b74f006480c58781c886c2a2b5c03d8bceb2a12";
const USDT_ADDR            = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"; // 6 dec
const WOKB_ADDR            = "0xe538905cf8410324e03a5a23c1c177a474d59b2b"; // 18 dec
const DEX_ROUTER           = "0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954";
const NATIVE_OKB           = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!DEPLOYER_PRIVATE_KEY) {
    console.error("❌ DEPLOYER_PRIVATE_KEY not set in .env");
    process.exitCode = 1; return;
  }

  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log("\n💱 Swap Deployer USDT → WOKB → Fund Agent");
  console.log("═══════════════════════════════════════════");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Agent:    ${AGENT_ADDRESS}`);

  // ── Read deployer balances ───────────────────────────────────
  const usdtCtx  = new ethers.Contract(USDT_ADDR, ERC20_ABI, deployer);
  const wokbCtx  = new ethers.Contract(WOKB_ADDR, ERC20_ABI, deployer);

  const usdtBal = await usdtCtx.balanceOf(deployer.address) as bigint;
  const okbBal  = await provider.getBalance(deployer.address);

  const usdtHuman = parseFloat(ethers.formatUnits(usdtBal, 6));
  const okbHuman  = parseFloat(ethers.formatEther(okbBal));

  console.log(`\n  📊 Deployer balances:`);
  console.log(`     USDT: ${usdtHuman.toFixed(6)}`);
  console.log(`     OKB:  ${okbHuman.toFixed(8)} (gas)`);

  if (usdtBal === 0n) {
    console.error("❌ Deployer has no USDT to swap.");
    process.exitCode = 1; return;
  }

  if (okbHuman < 0.00005) {
    console.error(`❌ Deployer only has ${okbHuman} OKB — too low for gas.`);
    process.exitCode = 1; return;
  }

  // Use up to $0.30 USDT, leaving $0.05 buffer in deployer
  const leaveBuffer = 50000n; // $0.05 USDT raw
  let swapAmount = usdtBal > leaveBuffer ? usdtBal - leaveBuffer : usdtBal;
  if (swapAmount > 300000n) swapAmount = 300000n; // cap at $0.30 for safety
  const swapAmountHuman = parseFloat(ethers.formatUnits(swapAmount, 6));
  console.log(`\n  Swapping: ${swapAmountHuman.toFixed(6)} USDT → WOKB`);

  // ── Step 1: Approve OKX DEX to spend USDT ───────────────────
  console.log(`\n  Step 1/3 — Approving OKX DEX router for USDT...`);
  const allowance = await usdtCtx.allowance(deployer.address, DEX_ROUTER) as bigint;
  if (allowance < swapAmount) {
    // Get approve calldata from OKX API
    let approveData: string;
    try {
      const approveResp = await okxApi.get("/api/v6/dex/aggregator/approve-transaction", {
        chainIndex: networkConfig.chainId.toString(),
        tokenContractAddress: USDT_ADDR,
        approveAmount: swapAmount.toString(),
      });
      if (approveResp.code === "0" && approveResp.data?.[0]?.data) {
        approveData = approveResp.data[0].data;
      } else {
        // fallback: manual approve(router, swapAmount)
        approveData = usdtCtx.interface.encodeFunctionData("approve", [DEX_ROUTER, swapAmount]);
      }
    } catch {
      approveData = usdtCtx.interface.encodeFunctionData("approve", [DEX_ROUTER, swapAmount]);
    }

    const approveTx = await deployer.sendTransaction({
      to: USDT_ADDR,
      data: approveData,
    });
    console.log(`  ⏳ Approve tx: ${approveTx.hash}`);
    await approveTx.wait(1);
    console.log(`  ✅ USDT approved for DEX router`);
    await sleep(2000);
  } else {
    console.log(`  ✅ Already approved (allowance: ${ethers.formatUnits(allowance, 6)} USDT)`);
  }

  // ── Step 2: Get swap calldata USDT → WOKB ───────────────────
  console.log(`\n  Step 2/3 — Fetching USDT → WOKB swap route from OKX DEX...`);
  await sleep(1000);

  let swapResp: any;
  try {
    swapResp = await okxApi.get("/api/v6/dex/aggregator/swap", {
      chainIndex: networkConfig.chainId.toString(),
      fromTokenAddress: USDT_ADDR,
      toTokenAddress: WOKB_ADDR,
      amount: swapAmount.toString(),
      slippagePercent: "3",
      userWalletAddress: deployer.address,
    });
  } catch (e: any) {
    console.error("❌ OKX DEX API error:", e.response?.data || e.message);
    process.exitCode = 1; return;
  }

  if (swapResp.code !== "0" || !swapResp.data?.[0]) {
    console.error("❌ Swap quote failed:", swapResp.msg || JSON.stringify(swapResp));
    process.exitCode = 1; return;
  }

  const route = swapResp.data[0];
  const expectedWokbRaw = route.routerResult?.toTokenAmount || "0";
  const expectedWokbHuman = parseFloat(ethers.formatEther(expectedWokbRaw));
  const expectedUsd = expectedWokbHuman * 85; // approx OKB price
  console.log(`  ✅ Route: ${swapAmountHuman} USDT → ~${expectedWokbHuman.toFixed(6)} WOKB (~$${expectedUsd.toFixed(3)})`);

  // ── Step 3: Execute swap ─────────────────────────────────────
  console.log(`\n  Step 3/3 — Executing swap...`);
  const swapTx = await deployer.sendTransaction({
    to: route.tx.to,
    data: route.tx.data,
    value: route.tx.value && route.tx.value !== "0" ? BigInt(route.tx.value) : 0n,
    gasLimit: route.tx.gas ? BigInt(Math.ceil(parseInt(route.tx.gas) * 1.2)) : undefined,
  });
  console.log(`  ⏳ Swap tx: ${swapTx.hash}`);
  await swapTx.wait(1);
  console.log(`  ✅ Swap confirmed!`);
  await sleep(3000);

  // ── Check how much WOKB deployer received ───────────────────
  const wokbDeployerBal = await wokbCtx.balanceOf(deployer.address) as bigint;
  const wokbHuman = parseFloat(ethers.formatEther(wokbDeployerBal));
  console.log(`  Deployer WOKB received: ${wokbHuman.toFixed(8)} (~$${(wokbHuman * 85).toFixed(3)})`);

  if (wokbDeployerBal === 0n) {
    console.error("❌ Either the swap sent WOKB elsewhere or the swap failed silently.");
    process.exitCode = 1; return;
  }

  // ── Transfer all WOKB to agent ───────────────────────────────────────────────
  console.log(`\n  Transferring ${wokbHuman.toFixed(8)} WOKB → Agent wallet...`);
  const transferTx = await deployer.sendTransaction({
    to: WOKB_ADDR,
    data: new ethers.Interface(ERC20_ABI).encodeFunctionData("transfer", [AGENT_ADDRESS, wokbDeployerBal]),
  });
  console.log(`  ⏳ Transfer tx: ${transferTx.hash}`);
  await transferTx.wait(1);
  console.log(`  ✅ WOKB transferred to agent!`);
  await sleep(2000);

  // ── Print final state ─────────────────────────────────────────
  const agentWokb = await wokbCtx.balanceOf(AGENT_ADDRESS) as bigint;
  const agentOkb  = await provider.getBalance(AGENT_ADDRESS);

  console.log("\n═══════════════════════════════════════════");
  console.log("  ✅ Agent wallet funded for validation!");
  console.log(`     WOKB: ${ethers.formatEther(agentWokb)} (~$${(parseFloat(ethers.formatEther(agentWokb)) * 85).toFixed(3)})`);
  console.log(`     OKB:  ${ethers.formatEther(agentOkb)} (gas)`);
  console.log("\n  🧪 Validation test — run npm run dev and send:");
  console.log("     http://localhost:3001/premium-article");
  console.log("\n  Watch for these log lines:");
  console.log("  [TokenEnricher] WOKB price updated: ...   ← okx-dex-token ✅");
  console.log("  [TxSimulator] Simulating tx: ...          ← okx-security ✅");
  console.log("  [PaymentVerifier:Gateway] Tracking tx...  ← okx-onchain-gateway ✅");
  console.log("═══════════════════════════════════════════\n");
}

main().catch(e => {
  console.error("\n❌", e.message || e);
  process.exitCode = 1;
});
