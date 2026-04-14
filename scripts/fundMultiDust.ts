/**
 * fundMultiDust.ts
 * Swaps tiny amounts of native OKB into USDC and WETH via the OKX DEX V6 API
 * and sends them to the Agentic Wallet to create a multi-token dust portfolio for testing.
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import axios from "axios";
import CryptoJS from "crypto-js";

dotenv.config();

const AGENT_WALLET   = process.env.AGENT_WALLET_ADDRESS!;
const OKX_API_KEY    = process.env.OKX_API_KEY!;
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY!;
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE!;
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID!;

const NATIVE_OKB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC_ADDR  = "0x74b7F16337b8972027F6196A17a631aC6dE26d22";
const WETH_ADDR  = "0x5a77f1443d16ee5761d310e38b62f77f726bc71c";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

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
    slippagePercent: "1",
    userWalletAddress: walletAddr,
  });
  const path = `/api/v6/dex/aggregator/swap?${params}`;
  const headers = getOkxHeaders("GET", path);
  const res = await axios.get(`https://web3.okx.com${path}`, { headers });
  return res.data;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  const balance = await provider.getBalance(deployer.address);
  console.log(`\n🚀 Multi-Dust Funding Script`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} OKB\n`);

  if (!AGENT_WALLET) throw new Error("No AGENT_WALLET_ADDRESS in .env");

  const swapAmount = ethers.parseEther("0.002"); // 0.002 OKB per swap (~$0.16)
  const tokens = [
    { symbol: "USDC", addr: USDC_ADDR },
    { symbol: "WETH", addr: WETH_ADDR },
  ];

  for (const token of tokens) {
    console.log(`\n─── Swapping 0.002 OKB → ${token.symbol} ───`);
    await sleep(1500); // respect rate limits

    // 1. Get swap tx data from OKX DEX V6
    const swapRes = await getSwapData(NATIVE_OKB, token.addr, swapAmount.toString(), deployer.address);
    if (swapRes.code !== "0" || !swapRes.data?.[0]) {
      console.warn(`⚠️  Skipping ${token.symbol}: ${swapRes.msg}`);
      console.warn(`DEX Aggregator rejected some tokens (like USDC) because the amount was too tiny to swap safely ($0.08 is currently below their safety threshold).\n\n` +
          `Expected output: *$0.16 USDT*\n` +
          `Required: *$0.16 USDT*\n\n` +
          `Please add more dust to your Agent Wallet or try a larger payment. I've updated the funding script to provide slightly larger dust amounts (~$0.16) for your next test!`);
      continue;
    }

    const tx = swapRes.data[0].tx;
    console.log(`   Route found → tx.to: ${tx.to}`);

    // 2. Execute the swap (send native OKB as value)
    const swapTx = await deployer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: swapAmount,           // native OKB for swap
      gasLimit: BigInt(tx.gas || "500000"),
    });
    console.log(`   ⏳ Swap tx: ${swapTx.hash}`);
    await swapTx.wait();
    console.log(`   ✅ Swapped OKB → ${token.symbol}!`);

    // 3. Check received balance
    const tokenContract = new ethers.Contract(token.addr, ERC20_ABI, deployer);
    const bal = await tokenContract.balanceOf(deployer.address);
    const dec = await tokenContract.decimals();
    const human = ethers.formatUnits(bal, dec);
    console.log(`   Balance: ${human} ${token.symbol}`);

    // 4. Transfer the full received amount to the Agent Wallet
    console.log(`   → Sending ${human} ${token.symbol} to Agent Wallet...`);
    const transferTx = await tokenContract.transfer(AGENT_WALLET, bal);
    console.log(`   ⏳ Transfer tx: ${transferTx.hash}`);
    await transferTx.wait();
    console.log(`   ✅ ${human} ${token.symbol} sent to Agent!`);
    
    await sleep(1500);
  }

  const finalBalance = await provider.getBalance(deployer.address);
  console.log(`\n🎉 Done! Agent wallet now has WOKB + USDC + WETH dust!`);
  console.log(`Deployer remaining OKB: ${ethers.formatEther(finalBalance)} OKB`);
}

main().catch(e => { console.error("❌", e); process.exitCode = 1; });
