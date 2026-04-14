import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { WalletScanner, TokenAsset } from "../services/WalletScanner";
import { SwapRouter, SwapRoute } from "../services/SwapRouter";
import { PaymentVerifier } from "../services/PaymentVerifier";
import { AgenticWallet } from "../services/AgenticWallet";
import { networkConfig } from "../config/network";

dotenv.config();

// ——————————————————————————————————
// Configuration
// ——————————————————————————————————
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS || "";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is required in .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const verifier = new PaymentVerifier();

// In-memory user state (wallet address per Telegram userId)
const userWallets: Map<number, string> = new Map();

// Pending payment sessions
interface PaymentSession {
  userId: number;
  merchantUrl: string;
  priceUsd: string;
  priceRaw: string;
  merchantAddress: string;
  targetToken: string;
  targetDecimals: number;
  dustBasket: TokenAsset[];
  swapRoutes: SwapRoute[];
  totalDustValue: number;
}
const pendingSessions: Map<number, PaymentSession> = new Map();

// ——————————————————————————————————
// Bot Commands
// ——————————————————————————————————

bot.start((ctx) => {
  const netLabel = networkConfig.isTestnet
    ? "X Layer Testnet 🧪"
    : "X Layer Mainnet 🔴";

  ctx.reply(
    `🧹 *Smart-Sweep Checkout*\n\n` +
      `I pay x402 paywalls using your wallet's *dust tokens* on ${netLabel}.\n\n` +
      `Your worthless token scraps → instant payment.\n\n` +
      `*How to use:*\n` +
      `1️⃣ Set your wallet: /setwallet 0x...\n` +
      `2️⃣ Paste a URL with a paywall\n` +
      `3️⃣ I'll find your dust and propose a payment\n` +
      `4️⃣ Click Approve — done!\n\n` +
      `_Powered by OKX Onchain OS on ${netLabel}_ ⛓️`,
    { parse_mode: "Markdown" }
  );
});

bot.command("setwallet", (ctx) => {
  const parts = ctx.message.text.split(" ");
  const address = parts[1];

  if (!address || !ethers.isAddress(address)) {
    ctx.reply("❌ Please provide a valid X Layer address.\n\nUsage: `/setwallet 0x...`", {
      parse_mode: "Markdown",
    });
    return;
  }

  userWallets.set(ctx.from.id, address);
  ctx.reply(
    `✅ Wallet set: \`${address}\`\n\n` +
      `Now paste any URL with a paywall and I'll sweep your dust to pay for it!`,
    { parse_mode: "Markdown" }
  );
});

bot.command("wallet", (ctx) => {
  const wallet = userWallets.get(ctx.from.id);
  if (wallet) {
    ctx.reply(`💰 Your wallet: \`${wallet}\``, { parse_mode: "Markdown" });
  } else {
    ctx.reply("❌ No wallet set. Use `/setwallet 0x...`", { parse_mode: "Markdown" });
  }
});

bot.command("dust", async (ctx) => {
  const wallet = userWallets.get(ctx.from.id);
  if (!wallet) {
    ctx.reply("❌ Set your wallet first with `/setwallet 0x...`", { parse_mode: "Markdown" });
    return;
  }

  const scanning = await ctx.reply("🔍 Scanning your wallet for dust tokens...");

  try {
    const dustTokens = await WalletScanner.getDustTokens(wallet);

    if (dustTokens.length === 0) {
      ctx.reply("🧹 Your wallet is clean — no dust tokens found on X Layer!");
      return;
    }

    let msg = `🗑️ *Your Dust Inventory (X Layer)*\n\n`;
    let total = 0;

    for (const token of dustTokens) {
      msg += `• *${token.symbol}*: $${token.usdValue.toFixed(2)}\n`;
      total += token.usdValue;
    }

    msg += `\n💰 *Total dust value:* $${total.toFixed(2)}`;
    msg += `\n\n_Paste a paywalled URL to spend this dust!_`;

    ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (error: any) {
    ctx.reply(`❌ Error scanning wallet: ${error.message}`);
  }
});

// ——————————————————————————————————
// URL Handler — Detects x402 Paywalls
// ——————————————————————————————————
bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // Skip if it's a command
  if (text.startsWith("/")) return;

  // Check if it looks like a URL
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return;

  const url = urlMatch[0];
  const wallet = userWallets.get(ctx.from.id);

  if (!wallet) {
    ctx.reply(
      "❌ Set your wallet first!\n\nUse `/setwallet 0xYourXLayerAddress`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const statusMsg = await ctx.reply(`🔗 Checking paywall at:\n${url}`);

  try {
    // ——— Phase 2: Read the Paywall (x402 Detection) ———
    let paywallData: any;

    try {
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status === 402 || status === 200,
      });

      if (response.status === 200) {
        ctx.reply("✅ This URL is already accessible — no payment needed!");
        return;
      }

      paywallData = response.data;
    } catch (err: any) {
      ctx.reply(`❌ Could not reach the URL: ${err.message}`);
      return;
    }

    // Parse x402 payment requirements
    if (!paywallData.accepts || paywallData.accepts.length === 0) {
      ctx.reply("❌ This URL returned a 402 but doesn't follow x402 standard.");
      return;
    }

    const paymentReq = paywallData.accepts[0];
    const priceUsd = paymentReq.extra?.priceUsd || "?";
    const priceRaw = paymentReq.maxAmountRequired;
    const merchantAddress = paymentReq.payToAddress;
    const targetToken = paymentReq.asset;
    const targetDecimals = paymentReq.extra?.decimals || 6;
    const description = paymentReq.description || "Payment required";

    await ctx.reply(
      `💳 *x402 Payment Detected!*\n\n` +
        `📄 ${description}\n` +
        `💰 Price: *$${priceUsd} USDT*\n` +
        `📬 Merchant: \`${merchantAddress}\`\n` +
        `⛓️ Network: ${networkConfig.networkName}\n\n` +
        `🔍 Scanning your dust to cover this...`,
      { parse_mode: "Markdown" }
    );

    // ——— Phase 2: Scan Dust ———
    const dustTokens = await WalletScanner.getDustTokens(wallet, targetToken);

    if (dustTokens.length === 0) {
      ctx.reply("😔 No dust tokens found in your wallet. Can't pay with dust!");
      return;
    }

    const basket = WalletScanner.selectDustBasket(dustTokens, parseFloat(priceUsd));

    if (!basket.sufficient) {
      ctx.reply(
        `😔 *Insufficient dust!*\n\n` +
          `Need: *$${priceUsd}*\n` +
          `Available dust: *$${basket.totalValue.toFixed(2)}*\n\n` +
          `You need more dust tokens in your X Layer wallet.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const TARGET_BUFFER = 1.05; // 5% buffer for slippage - ensures exactly $0.03 WETH remains in user's test scenario
    const targetWithBuffer = parseFloat(priceUsd) * TARGET_BUFFER;
    
    let finalUsdtUsedFromBalance = 0;
    let finalSwapRoutes: SwapRoute[] = [];
    let finalTokensWithAmounts: { token: TokenAsset; amountRaw?: string }[] = [];
    
    let fallbackAttempt = 0;
    const blocklistedTokenAddresses = new Set<string>();

    while (fallbackAttempt < 5) { // Protect against infinite loops
      fallbackAttempt++;
      
      // Filter out blocklisted tokens
      const eligibleDust = dustTokens.filter(t => !blocklistedTokenAddresses.has(t.tokenAddress.toLowerCase()));
      const basket = WalletScanner.selectDustBasket(eligibleDust, parseFloat(priceUsd));

      if (!basket.sufficient && fallbackAttempt === 1) {
        ctx.reply(`😔 *Insufficient dust!*\n\nNeed: *$${priceUsd}*\nAvailable: *$${basket.totalValue.toFixed(2)}*`, { parse_mode: "Markdown" });
        return;
      }

      // 1. Determine tokens to route
      let remainingToCollect = targetWithBuffer;
      const currentTokensToRoute: { token: TokenAsset; amountRaw?: string }[] = [];
      let currentUsdtFromBalance = 0;

      for (const token of basket.selected) {
        if (remainingToCollect <= 0) break;
        const isTargetToken = token.tokenAddress?.toLowerCase() === targetToken.toLowerCase();

        if (isTargetToken) {
          const amountFromBalance = Math.min(token.usdValue, remainingToCollect);
          currentUsdtFromBalance += amountFromBalance;
          remainingToCollect -= amountFromBalance;
          continue;
        }

        if (token.usdValue <= remainingToCollect) {
          currentTokensToRoute.push({ token });
          remainingToCollect -= token.usdValue;
        } else {
          const amountNeededFloat = remainingToCollect / parseFloat(token.tokenPrice);
          const rawPartialAmount = ethers.parseUnits(amountNeededFloat.toFixed(token.decimals), token.decimals).toString();
          currentTokensToRoute.push({ token, amountRaw: rawPartialAmount });
          remainingToCollect = 0;
        }
      }

      // 2. Request routes
      if (currentTokensToRoute.length === 0) {
        // We covered it all with existing balance!
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = [];
        finalTokensWithAmounts = [];
        break;
      }

      console.log(`[Bot] Routing attempt #${fallbackAttempt}... choosing ${currentTokensToRoute.map(t => t.token.symbol).join(", ")}`);
      const { routes, failures } = await SwapRouter.getSwapRoutes(currentTokensToRoute, AGENT_WALLET_ADDRESS, targetToken);

      if (failures.length === 0) {
        // PERFECT — All selected tokens routed successfully
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = routes;
        finalTokensWithAmounts = currentTokensToRoute;
        break;
      }

      // PARTIAL FAILURE — Blocklist the failed tokens and try again
      console.log(`[Bot] Routing failure for ${failures.map(f => f.symbol).join(", ")}. Retrying with remaining tokens...`);
      
      for (const fail of failures) {
        const failToken = currentTokensToRoute.find(t => t.token.symbol === fail.symbol);
        if (failToken) blocklistedTokenAddresses.add(failToken.token.tokenAddress.toLowerCase());
      }

      // Check if the SUCCESSFUL routes in this batch are already enough
      const batchOutput = currentUsdtFromBalance + routes.reduce((s, r) => s + parseFloat(r.estimatedOutputUsd), 0);
      if (batchOutput >= parseFloat(priceUsd)) {
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = routes;
        finalTokensWithAmounts = currentTokensToRoute.filter(t => !failures.find(f => f.symbol === t.token.symbol));
        break;
      }

      // Otherwise, loop again to pick more tokens
    }

    const totalEstimatedOutput = finalUsdtUsedFromBalance + finalSwapRoutes.reduce(
      (sum, r) => sum + parseFloat(r.estimatedOutputUsd),
      0
    );

    if (totalEstimatedOutput < parseFloat(priceUsd)) {
      ctx.reply(
        `⚠️ *Routing Failure*\n\n` +
          `DEX Aggregator rejected your tokens (USDC/WETH) because the amounts were too tiny to swap safely on X Layer Mainnet.\n\n` +
          `Current dust portfolio is too small to cover this payment after DEX safety checks.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Store the session
    const session: PaymentSession = {
      userId: ctx.from.id,
      merchantUrl: url,
      priceUsd,
      priceRaw,
      merchantAddress,
      targetToken,
      targetDecimals,
      dustBasket: basket.selected,
      swapRoutes: finalSwapRoutes,
      totalDustValue: basket.totalValue,
    };
    pendingSessions.set(ctx.from.id, session);

    // ——— Phase 3: Show the Proposal ———
    let proposalMsg = `🧹 *Dust Sweep Proposal*\n\n`;
    proposalMsg += `*Paying:* $${priceUsd} USDT\n\n`;
    proposalMsg += `*Dust to liquidate:*\n`;

    if (finalUsdtUsedFromBalance > 0) {
      proposalMsg += `  • USDT (Balance): ~$${finalUsdtUsedFromBalance.toFixed(2)} USDT\n`;
    }

    for (const route of finalSwapRoutes) {
      const tokenWithAmount = finalTokensWithAmounts.find(t => t.token.symbol === route.inputToken.symbol);
      const isPartial = !!tokenWithAmount?.amountRaw;
      const displayAmount = isPartial 
        ? ethers.formatUnits(tokenWithAmount!.amountRaw!, route.inputToken.decimals)
        : route.inputToken.balance;

      proposalMsg += `  • ${route.inputToken.symbol} (${parseFloat(displayAmount).toFixed(6)}): $${(parseFloat(displayAmount) * parseFloat(route.inputToken.tokenPrice)).toFixed(2)} → ~$${route.estimatedOutputUsd} USDT\n`;
    }

    proposalMsg += `\n*Total estimated output:* $${totalEstimatedOutput.toFixed(2)} USDT\n`;
    proposalMsg += `*Merchant receives:* $${priceUsd} USDT\n`;

    const refund = totalEstimatedOutput - parseFloat(priceUsd);
    if (refund > 0) {
      proposalMsg += `*Refund to you:* ~$${refund.toFixed(2)} USDT\n`;
    }

    proposalMsg += `\n⚡ _${finalSwapRoutes.length} swaps + 1 transfer = single checkout_`;

    ctx.reply(proposalMsg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🟢 Approve & Pay with Dust", "approve_payment")],
        [Markup.button.callback("❌ Cancel", "cancel_payment")],
      ]),
    });
  } catch (error: any) {
    console.error("[Bot] Error:", error);
    ctx.reply(`❌ Something went wrong: ${error.message}`);
  }
});

// ——————————————————————————————————
// Callback: Approve Payment
// ——————————————————————————————————
bot.action("approve_payment", async (ctx) => {
  await ctx.answerCbQuery("Processing payment...");

  const userId = ctx.from!.id;
  const session = pendingSessions.get(userId);

  if (!session) {
    ctx.reply("❌ No pending payment found. Please paste the URL again.");
    return;
  }

  const wallet = userWallets.get(userId);
  if (!wallet) {
    ctx.reply("❌ Wallet not set.");
    return;
  }

  await ctx.editMessageText("⏳ *Executing dust sweep...*\n\n🔄 Broadcasting swaps to X Layer...", {
    parse_mode: "Markdown",
  });

  try {
    const isMock = process.env.MOCK_MODE === "true";

    if (isMock) {
      // ——— MOCK EXECUTION ———
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const mockTxHash = "0x" + "a]b".repeat(10) + Date.now().toString(16);

      // Notify mock merchant
      try {
        await axios.post(
          `http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`,
          { txHash: mockTxHash }
        );
      } catch {}

      const explorerUrl = `${networkConfig.explorerUrl}/tx/${mockTxHash}`;

      await ctx.editMessageText(
        `✅ *Payment Successful!* 🎉\n\n` +
          `🧹 Swept ${session.swapRoutes.length} dust tokens\n` +
          `💰 Paid $${session.priceUsd} USDT to merchant\n` +
          `⛓️ Network: ${networkConfig.networkName} (MOCK)\n` +
          `📄 Tx: \`${mockTxHash}\`\n\n` +
          `🔓 *Access your content:*\n` +
          `${session.merchantUrl}?receipt=${mockTxHash}`,
        { parse_mode: "Markdown" }
      );
    } else {
      // ——— LIVE EXECUTION VIA AGENTIC WALLET (TEE) ———
      const txHashes: string[] = [];

      // Execute each swap sequentially (approve → swap)
      for (const route of session.swapRoutes) {
        // 1. Approve token spend if needed
        if (route.approveData) {
          console.log(`[Bot] Approving ${route.inputToken.symbol} via Agentic Wallet...`);
          const approveTxHash = await AgenticWallet.sendTransaction(
            route.approveData.to,
            route.approveData.data
          );
          await verifier.waitForConfirmation(approveTxHash, 30000);
        }

        // 2. Execute swap
        console.log(`[Bot] Swapping ${route.inputToken.symbol} → USDT via Agentic Wallet...`);
        const swapTxHash = await AgenticWallet.sendTransaction(
          route.txData.to,
          route.txData.data,
          route.txData.value
        );
        await verifier.waitForConfirmation(swapTxHash, 30000);
        txHashes.push(swapTxHash);

        await ctx.editMessageText(
          `⏳ *Sweeping dust using Agentic Wallet...*\n\n` +
            `✅ ${route.inputToken.symbol} swapped\n` +
            `📄 Tx: \`${swapTxHash}\``,
          { parse_mode: "Markdown" }
        );
      }

      // 3. Transfer USDT to merchant
      console.log(`[Bot] Transferring $${session.priceUsd} USDT to merchant via Agentic Wallet...`);
      const usdtInterface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);

      const transferData = usdtInterface.encodeFunctionData("transfer", [
        session.merchantAddress,
        BigInt(session.priceRaw),
      ]);

      const transferTxHash = await AgenticWallet.sendTransaction(
        session.targetToken,
        transferData
      );
      await verifier.waitForConfirmation(transferTxHash, 30000);

      // Notify merchant
      try {
        await axios.post(
          `http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`,
          { txHash: transferTxHash }
        );
      } catch {}

      const explorerUrl = `${networkConfig.explorerUrl}/tx/${transferTxHash}`;

      await ctx.editMessageText(
        `✅ *Payment Successful!* 🎉\n\n` +
          `🔒 *Secured by Agentic Wallet (TEE)*\n` +
          `🧹 Swept ${session.swapRoutes.length} dust tokens\n` +
          `💰 Paid $${session.priceUsd} USDT to merchant\n` +
          `⛓️ Network: ${networkConfig.networkName}\n` +
          `📄 Payment Tx: [${transferTxHash.slice(0, 10)}...](${explorerUrl})\n\n` +
          `🔓 *Access your content:*\n` +
          `${session.merchantUrl}?receipt=${transferTxHash}`,
        { 
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true }
        }
      );
    }

    // Clean up session
    pendingSessions.delete(userId);
  } catch (error: any) {
    console.error("[Bot] Payment execution error:", error);
    ctx.reply(`❌ Payment failed: ${error.message}\n\nYour tokens are safe — the transaction was reverted.`);
  }
});

bot.action("cancel_payment", async (ctx) => {
  await ctx.answerCbQuery("Payment cancelled.");
  pendingSessions.delete(ctx.from!.id);
  ctx.editMessageText("❌ Payment cancelled. Your dust is safe!");
});

// Help command
bot.help((ctx) => {
  ctx.reply(
    `🧹 *Smart-Sweep Checkout — Commands*\n\n` +
      `/start — Welcome message\n` +
      `/setwallet 0x... — Set your X Layer wallet\n` +
      `/wallet — Show your current wallet\n` +
      `/dust — View your dust token inventory\n` +
      `/help — This message\n\n` +
      `*How it works:*\n` +
      `Paste any URL → I detect the x402 paywall → sweep your dust → pay the merchant → unlock the content.\n\n` +
      `_Built on X Layer with OKX Onchain OS_ ⛓️`,
    { parse_mode: "Markdown" }
  );
});

// ——————————————————————————————————
// Launch Bot
// ——————————————————————————————————
bot.launch().then(() => {
  console.log("\n🤖 Smart-Sweep Checkout bot is running!");
  console.log("   Send /start in Telegram to begin.\n");
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
