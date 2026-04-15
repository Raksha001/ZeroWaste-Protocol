/**
 * fundSingleTokenDemo.ts
 *
 * Sets up the agent wallet for Scenario 3 testing:
 *   → Single token sweep: one non-USDT token covers the entire paywall by itself.
 *
 * What this script does:
 *   1. Prints current balances of Deployer + Agent wallets
 *   2. Swaps OKB → USDC (via OKX DEX V6) from Deployer wallet
 *   3. Sends the received USDC to the Agent wallet
 *
 * Target: Agent wallet ends up with ~$0.50 USDC — enough to cover
 *   /premium-article ($0.12) or /premium-news ($0.30) with comfortable slippage margin.
 *
 * IMPORTANT: Make sure the agent wallet has NO USDT >= $0.12 before testing,
 *   otherwise the bot's direct-pay fast path triggers instead of the swap path.
 *
 * Run:
 *   npx hardhat run src/scripts/fundSingleTokenDemo.ts --network xlayer
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import axios from "axios";
import CryptoJS from "crypto-js";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
const OKX_API_KEY    = process.env.OKX_API_KEY!;
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY!;
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE!;
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID!;

/** 
 * Test-user agent wallet (from .data/user-wallets.json, Telegram user 1305115471).
 * This is the wallet the bot uses when running in the test session.
 */
const AGENT_WALLET = "0x2b74f006480c58781c886c2a2b5c03d8bceb2a12";

// Token addresses on X Layer Mainnet (Chain ID 196)
const NATIVE_OKB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC_ADDR  = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const USDT_ADDR  = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d";
const USDC_E_ADDR = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035";
const WETH_ADDR  = "0x5a77f1443d16ee5761d310e38b62f77f726bc71c";
const WOKB_ADDR  = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// How much OKB to swap → USDC. ~0.006 OKB ≈ $0.50 at ~$84/OKB
// Increase if you need more USDC (e.g. for $2.00 /api-access test, use 0.03 OKB)
const OKB_SWAP_AMOUNT = ethers.parseEther("0.006");

// ─── OKX API helpers ─────────────────────────────────────────────────────────
function getOkxHeaders(method: string, path: string, body = "") {
  const ts = new Date().toISOString();
  const pre = ts + method.toUpperCase() + path + body;
  const sig = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(pre, OKX_SECRET_KEY));
  return {
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": sig,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "OK-ACCESS-PROJECT": OKX_PROJECT_ID,
    "Content-Type": "application/json",
  };
}

async function getSwapData(fromAddr: string, toAddr: string, amount: string, walletAddr: string) {
  const params = new URLSearchParams({
    chainIndex: "196",
    fromTokenAddress: fromAddr,
    toTokenAddress: toAddr,
    amount,
    slippagePercent: "2",
    userWalletAddress: walletAddr,
  });
  const path = `/api/v6/dex/aggregator/swap?${params}`;
  const headers = getOkxHeaders("GET", path);
  const res = await axios.get(`https://web3.okx.com${path}`, { headers, timeout: 15000 });
  return res.data;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Balance printer ─────────────────────────────────────────────────────────
async function printBalances(label: string, addr: string, provider: any) {
  const tokens = [
    { symbol: "USDT",   addr: USDT_ADDR,   dec: 6  },
    { symbol: "USDC",   addr: USDC_ADDR,   dec: 6  },
    { symbol: "USDC.e", addr: USDC_E_ADDR, dec: 6  },
    { symbol: "WETH",   addr: WETH_ADDR,   dec: 18 },
    { symbol: "WOKB",   addr: WOKB_ADDR,   dec: 18 },
  ];

  console.log(`\n┌─ ${label}`);
  console.log(`│  ${addr}`);
  const okb = await provider.getBalance(addr);
  console.log(`│  OKB:    ${ethers.formatEther(okb)}`);

  for (const t of tokens) {
    try {
      const c = new ethers.Contract(t.addr, ERC20_ABI, provider);
      const bal = await c.balanceOf(addr);
      if (bal > 0n) {
        console.log(`│  ${t.symbol.padEnd(7)}: ${ethers.formatUnits(bal, t.dec)}`);
      }
    } catch { /* skip */ }
  }
  console.log("└────────────────────────────────");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("\n🧹 ZeroWaste Protocol — Single Token Demo Funder");
  console.log("══════════════════════════════════════════\n");
  console.log(`Deployer (has private key): ${deployer.address}`);
  console.log(`Agent wallet (TEE target):  ${AGENT_WALLET}`);

  // ──────────────────────────────────────────────
  // Step 1: Show current balances
  // ──────────────────────────────────────────────
  console.log("\n📊 BEFORE:");
  await printBalances("Deployer", deployer.address, provider);
  await printBalances("Agent Wallet", AGENT_WALLET, provider);

  const deployerOkb = await provider.getBalance(deployer.address);
  const minRequired = OKB_SWAP_AMOUNT + ethers.parseEther("0.005"); // swap + gas buffer
  if (deployerOkb < minRequired) {
    console.error(`\n❌ Deployer doesn't have enough OKB.`);
    console.error(`   Need: ${ethers.formatEther(minRequired)} OKB`);
    console.error(`   Have: ${ethers.formatEther(deployerOkb)} OKB`);
    process.exitCode = 1;
    return;
  }

  // Check if agent already has USDT >= $0.12 (fast path would trigger instead of swap)
  const usdtContract = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
  const agentUsdt = await usdtContract.balanceOf(AGENT_WALLET);
  const agentUsdtHuman = parseFloat(ethers.formatUnits(agentUsdt, 6));
  if (agentUsdtHuman >= 0.12) {
    console.warn(`\n⚠️  WARNING: Agent wallet already has ${agentUsdtHuman.toFixed(6)} USDT.`);
    console.warn("   The bot will use the direct-pay fast path instead of the single-token swap.");
    console.warn("   Drain USDT from the agent wallet first, or test with /premium-article and ensure USDT < $0.12.\n");
  }

  // ──────────────────────────────────────────────
  // Step 2: Swap OKB → USDC via OKX DEX
  // ──────────────────────────────────────────────
  console.log(`\n🔄 Step 1/2 — Swapping ${ethers.formatEther(OKB_SWAP_AMOUNT)} OKB → USDC via OKX DEX...`);
  await sleep(1000);

  const swapRes = await getSwapData(
    NATIVE_OKB,
    USDC_ADDR,
    OKB_SWAP_AMOUNT.toString(),
    deployer.address
  );

  if (swapRes.code !== "0" || !swapRes.data?.[0]) {
    console.error("\n❌ OKX DEX swap quote failed:", swapRes.msg || JSON.stringify(swapRes));
    process.exitCode = 1;
    return;
  }

  const tx = swapRes.data[0].tx;
  const expectedUsdc = parseFloat(swapRes.data[0].routerResult?.toTokenAmount || "0") / 1e6;
  console.log(`   ✅ Route found. Expected output: ~${expectedUsdc.toFixed(6)} USDC`);
  console.log(`   📄 Sending swap tx...`);

  const swapTx = await deployer.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: OKB_SWAP_AMOUNT,        // native OKB sent as msg.value
    gasLimit: BigInt(tx.gas || "500000"),
  });
  console.log(`   ⏳ Swap tx hash: ${swapTx.hash}`);
  await swapTx.wait();
  console.log(`   ✅ Swap confirmed!`);

  // ──────────────────────────────────────────────
  // Step 3: Transfer received USDC to Agent Wallet
  // ──────────────────────────────────────────────
  console.log(`\n📤 Step 2/2 — Sending USDC to Agent Wallet...`);
  await sleep(1500);

  const usdcContract = new ethers.Contract(USDC_ADDR, ERC20_ABI, deployer);
  const usdcBalance = await usdcContract.balanceOf(deployer.address);
  const usdcHuman = parseFloat(ethers.formatUnits(usdcBalance, 6));

  if (usdcBalance === 0n) {
    console.error("❌ No USDC received after swap. Check the DEX response.");
    process.exitCode = 1;
    return;
  }

  console.log(`   Deployer now has: ${usdcHuman.toFixed(6)} USDC`);
  const transferTx = await usdcContract.transfer(AGENT_WALLET, usdcBalance);
  console.log(`   ⏳ Transfer tx hash: ${transferTx.hash}`);
  await transferTx.wait();
  console.log(`   ✅ Transferred ${usdcHuman.toFixed(6)} USDC to Agent Wallet!`);

  // ──────────────────────────────────────────────
  // Step 4: Final balances
  // ──────────────────────────────────────────────
  console.log("\n📊 AFTER:");
  await printBalances("Deployer", deployer.address, provider);
  await printBalances("Agent Wallet", AGENT_WALLET, provider);

  console.log("\n✅ Done! Agent wallet is ready for single-token sweep test.");
  console.log("\n📋 Test instructions:");
  console.log("   1. Make sure the bot is running (npm run dev)");
  console.log("   2. Send /start or /dust to check agent wallet contents");
  console.log("   3. Paste: http://localhost:3001/premium-article  ($0.12 — USDC → USDT swap)");
  console.log("   4. Or:    http://localhost:3001/premium-news      ($0.30 — USDC → USDT swap)");
  console.log("   Expected bot path: 1 swap (USDC → USDT) → pay merchant ✅\n");
}

main().catch(e => { console.error("❌", e.message || e); process.exitCode = 1; });
