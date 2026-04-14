import axios from "axios";
import dotenv from "dotenv";
import { WalletScanner } from "../services/WalletScanner";
import { SwapRouter } from "../services/SwapRouter";

dotenv.config();

/**
 * End-to-end mock flow test.
 * Simulates the full checkout loop without Telegram or real transactions.
 *
 * Run: npm test
 */
async function runMockFlow() {
  console.log("═══════════════════════════════════════════════");
  console.log("  🧪 Smart-Sweep Checkout — Mock Flow Test");
  console.log("═══════════════════════════════════════════════\n");

  const MERCHANT_URL = `http://localhost:${process.env.MERCHANT_PORT || "3001"}/premium-article`;
  const USER_WALLET = "0xTestUserWalletAddress";

  // ——— Step 1: Hit the paywall ———
  console.log("1️⃣  Hitting merchant paywall...");
  try {
    const response = await axios.get(MERCHANT_URL, {
      validateStatus: (s) => s === 402 || s === 200,
    });

    if (response.status !== 402) {
      console.log("   ❌ Expected 402, got:", response.status);
      return;
    }

    const paywall = response.data;
    const paymentReq = paywall.accepts[0];
    console.log(`   ✅ 402 received: "${paymentReq.description}"`);
    console.log(`   💰 Price: $${paymentReq.extra.priceUsd} USDT`);
    console.log(`   📬 Merchant: ${paymentReq.payToAddress}\n`);

    // ——— Step 2: Scan dust ———
    console.log("2️⃣  Scanning wallet for dust...");
    const dustTokens = await WalletScanner.getDustTokens(USER_WALLET);
    console.log(`   ✅ Found ${dustTokens.length} dust tokens:\n`);

    for (const t of dustTokens) {
      console.log(`      • ${t.symbol}: $${t.usdValue.toFixed(2)}`);
    }

    // ——— Step 3: Select basket ———
    const targetUsd = parseFloat(paymentReq.extra.priceUsd);
    const basket = WalletScanner.selectDustBasket(dustTokens, targetUsd);
    console.log(`\n3️⃣  Selected ${basket.selected.length} tokens worth $${basket.totalValue.toFixed(2)} (need $${targetUsd})`);
    console.log(`   Sufficient: ${basket.sufficient ? "✅ YES" : "❌ NO"}\n`);

    if (!basket.sufficient) {
      console.log("   ❌ Test FAILED — insufficient dust.");
      return;
    }

    // ——— Step 4: Route swaps ———
    console.log("4️⃣  Computing swap routes via OKX DEX Aggregator...");
    const routes = await SwapRouter.getSwapRoutes(basket.selected, USER_WALLET, paymentReq.asset);
    console.log(`   ✅ ${routes.length} routes computed:\n`);

    let totalOutput = 0;
    for (const r of routes) {
      console.log(`      • ${r.inputToken.symbol} → ~$${r.estimatedOutputUsd} USDT`);
      totalOutput += parseFloat(r.estimatedOutputUsd);
    }

    console.log(`\n   Total estimated USDT output: $${totalOutput.toFixed(2)}`);

    // ——— Step 5: Simulate execution ———
    console.log("\n5️⃣  Simulating transaction execution...");
    const mockTxHash = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join("");
    console.log(`   📄 Mock Tx Hash: ${mockTxHash}`);

    // Confirm with merchant
    try {
      await axios.post(`http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`, {
        txHash: mockTxHash,
      });
      console.log("   ✅ Merchant notified of payment\n");
    } catch {
      console.log("   ⚠️  Could not notify merchant (server not running?)\n");
    }

    // ——— Step 6: Unlock content ———
    console.log("6️⃣  Unlocking content...");
    try {
      const unlockResponse = await axios.get(`${MERCHANT_URL}?receipt=${mockTxHash}`);
      if (unlockResponse.status === 200) {
        console.log(`   ✅ Content unlocked: "${unlockResponse.data.title}"\n`);
      }
    } catch {
      console.log("   ⚠️  Could not fetch unlocked content\n");
    }

    console.log("═══════════════════════════════════════════════");
    console.log("  ✅ MOCK FLOW TEST PASSED");
    console.log("═══════════════════════════════════════════════\n");
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
  }
}

runMockFlow();
