import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.MERCHANT_PORT || "3001");
const MERCHANT_WALLET = process.env.MERCHANT_WALLET_ADDRESS || "0xMerchantWalletAddress";

// Simple in-memory store of paid txHashes
const paidReceipts = new Set<string>();

/**
 * Mock Merchant Server
 *
 * Simulates a content paywall using the x402 Payment Required standard.
 * This is the server that the Telegram bot will hit to detect payment requirements.
 */

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "zerowaste-merchant" });
});

/**
 * Premium content endpoint.
 *
 * - Without payment: Returns 402 Payment Required with x402 headers.
 * - With valid receipt: Returns 200 with the content.
 */
app.get("/premium-article", (req, res) => {
  const receipt = req.query.receipt as string | undefined;

  // If a valid receipt is provided, serve the content
  if (receipt && paidReceipts.has(receipt)) {
    res.status(200).json({
      title: "🔓 The Future of Agentic Payments on X Layer",
      content: `
        This is the premium article content that was unlocked via ZeroWaste Protocol!
        
        The x402 protocol enables machine-to-machine payments at the HTTP level. 
        Instead of API keys and subscriptions, agents pay per-request using 
        stablecoins on chains like X Layer.
        
        Your dust tokens were automatically converted to USDT and sent to the 
        merchant — all in a single, seamless checkout flow.
        
        Welcome to the future of internet commerce. 🚀
      `.trim(),
      unlockedAt: new Date().toISOString(),
    });
    return;
  }

  // No payment → return 402 Payment Required (x402 standard)
  res.status(402).json({
    // x402 standard fields
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "xlayer-mainnet",
        maxAmountRequired: "120000",          // 0.12 USDT (6 decimals)
        resource: `http://localhost:${PORT}/premium-article`,
        description: "Premium article access — The Future of Agentic Payments",
        mimeType: "application/json",
        payToAddress: MERCHANT_WALLET,
        maxTimeoutSeconds: 300,
        asset: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",   // USDT on X Layer
        extra: {
          name: "USDT",
          decimals: 6,
          priceUsd: "0.12",
        },
      },
    ],
  });
});

/**
 * Callback to mark a receipt as paid.
 * The bot calls this after successful payment to "unlock" the content.
 */
app.post("/confirm-payment", express.json(), (req, res) => {
  const { txHash } = req.body;

  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }

  paidReceipts.add(txHash);
  console.log(`[Merchant] ✅ Payment confirmed: ${txHash}`);

  res.json({
    success: true,
    unlockUrl: `http://localhost:${PORT}/premium-article?receipt=${txHash}`,
  });
});

// ——— Premium Product 2: API Access ———
app.get("/api-access", (req, res) => {
  const receipt = req.query.receipt as string | undefined;

  if (receipt && paidReceipts.has(receipt)) {
    res.status(200).json({
      apiKey: "sk-demo-" + receipt.slice(0, 16),
      expiresIn: "24h",
      message: "API access granted via dust payment!",
    });
    return;
  }

  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "xlayer-mainnet",
        maxAmountRequired: "2000000",          // 2 USDT
        resource: `http://localhost:${PORT}/api-access`,
        description: "24-hour API access key",
        payToAddress: MERCHANT_WALLET,
        asset: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
        extra: { name: "USDT", decimals: 6, priceUsd: "2.00" },
      },
    ],
  });
});

// ——— Premium Product 3: Breaking News (two-token sweep demo) ———
app.get("/premium-news", (req, res) => {
  const receipt = req.query.receipt as string | undefined;

  if (receipt && paidReceipts.has(receipt)) {
    res.status(200).json({
      title: "Breaking: Agentic AI Pays for Its Own Content",
      body: "In a world-first, an AI agent autonomously swept dust tokens to pay for this article...",
      message: "Full article unlocked via multi-token dust sweep!",
    });
    return;
  }

  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "xlayer-mainnet",
        maxAmountRequired: "300000",          // 0.30 USDT (6 decimals)
        resource: `http://localhost:${PORT}/premium-news`,
        description: "Breaking news: Agentic AI pays its own way",
        payToAddress: MERCHANT_WALLET,
        asset: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
        extra: { name: "USDT", decimals: 6, priceUsd: "0.30" },
      },
    ],
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🏪 Mock Merchant Server running on http://localhost:${PORT}`);
  console.log(`   Paywall:  GET  http://localhost:${PORT}/premium-article  ($0.12)`);
  console.log(`   News:     GET  http://localhost:${PORT}/premium-news      ($0.30 — two-token demo)`);
  console.log(`   API:      GET  http://localhost:${PORT}/api-access        ($2.00)`);
  console.log(`   Merchant wallet: ${MERCHANT_WALLET}\n`);
});
