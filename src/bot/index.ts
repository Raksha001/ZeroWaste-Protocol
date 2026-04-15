import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { WalletScanner, TokenAsset } from "../services/WalletScanner";
import { SwapRouter, SwapRoute } from "../services/SwapRouter";
import { PaymentVerifier } from "../services/PaymentVerifier";
import { AgenticWallet } from "../services/AgenticWallet";
import { UserWalletStore, UserWallet, DEFAULT_DUST_THRESHOLD_USD } from "../services/UserWalletStore";
import { networkConfig } from "../config/network";
import { IntentParser } from "../services/IntentParser";
import { TokenEnricher } from "../services/TokenEnricher";
import { TxSimulator } from "../services/TxSimulator";
import { AuditLog } from "../services/AuditLog";

dotenv.config();

// ——————————————————————————————————
// Configuration
// ——————————————————————————————————
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is required in .env");
  process.exit(1);
}

if (!process.env.AGENT_ACCOUNT_ID && !process.env.AGENT_PRIVATE_KEY) {
  console.error("❌ Either AGENT_ACCOUNT_ID (onchainos) or AGENT_PRIVATE_KEY (ethers) is required in .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const verifier = new PaymentVerifier();

// Pending payment sessions (in-memory, cleared on bot restart)
interface PaymentSession {
  userId: number;
  signingKey: string;        // privateKey (ethers mode) OR accountId (onchainos mode)
  walletAddress: string;     // the user's agent wallet address
  merchantUrl: string;
  priceUsd: string;
  priceRaw: string;
  merchantAddress: string;
  targetToken: string;
  targetDecimals: number;
  dustBasket: TokenAsset[];
  swapRoutes: SwapRoute[];
  tokensWithAmounts: { token: TokenAsset; amountRaw?: string }[];
  totalDustValue: number;
  directPaymentMode?: boolean;
}
const pendingSessions: Map<number, PaymentSession> = new Map();

// ——————————————————————————————————
// Helpers
// ——————————————————————————————————

/**
 * Get or create a wallet for a user. Shows an error and returns null if creation fails.
 */
async function getOrCreateWallet(
  ctx: any,
  userId: number
): Promise<UserWallet | null> {
  try {
    return await UserWalletStore.createForUser(userId);
  } catch (err: any) {
    console.error(`[Bot] Failed to create wallet for user ${userId}:`, err.message);
    await ctx.reply(
      "❌ Could not create your agent wallet. Please try again in a moment."
    );
    return null;
  }
}

// ——————————————————————————————————
// Bot Commands
// ——————————————————————————————————

bot.start(async (ctx) => {
  const netLabel = networkConfig.isTestnet
    ? "X Layer Testnet 🧪"
    : "X Layer Mainnet 🔴";

  await ctx.reply(
    `🧹 *ZeroWaste Protocol*\n\n` +
      `I pay x402 paywalls using your wallet's *dust tokens* on ${netLabel}.\n\n` +
      `Your worthless token scraps → instant payment.\n\n` +
      `_Setting up your agent wallet..._`,
    { parse_mode: "Markdown" }
  );

  // Create (or retrieve) a dedicated TEE wallet for this user
  const wallet = await getOrCreateWallet(ctx, ctx.from.id);
  if (!wallet) return;

  await ctx.reply(
    `✅ *Your ZeroWaste Protocol Agent Wallet is ready!*\n\n` +
      `📬 *Deposit address:*\n\`${wallet.address}\`\n\n` +
      `*How to use:*\n` +
      `1️⃣ Send your dust tokens to the address above\n` +
      `2️⃣ Also send a little OKB for gas (≥ 0.002 OKB)\n` +
      `3️⃣ Paste any paywalled URL here\n` +
      `4️⃣ Click Approve — done!\n\n` +
      `_Powered by OKX Onchain OS on ${netLabel}_ ⛓️`,
    { parse_mode: "Markdown" }
  );
});

bot.command("wallet", async (ctx) => {
  const wallet = UserWalletStore.get(ctx.from.id);
  if (wallet) {
    const explorerUrl = `${networkConfig.explorerUrl}/address/${wallet.address}`;
    await ctx.reply(
      `💰 *Your Agent Wallet*\n\n` +
        `📬 Address: \`${wallet.address}\`\n` +
        `🔗 [View on explorer](${explorerUrl})\n\n` +
        `Send dust tokens + a little OKB (gas) to this address to fund payments.`,
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    );
  } else {
    await ctx.reply(
      "❌ No wallet yet. Send /start to set one up.",
      { parse_mode: "Markdown" }
    );
  }
});

bot.command("dust", async (ctx) => {
  let wallet = UserWalletStore.get(ctx.from.id);
  if (!wallet) {
    wallet = await getOrCreateWallet(ctx, ctx.from.id);
    if (!wallet) return;
  }

  const threshold = UserWalletStore.getDustThreshold(ctx.from.id);
  await ctx.reply(`🔍 Scanning your agent wallet for dust tokens (threshold: $${threshold})...`);

  try {
    const dustTokens = await WalletScanner.getDustTokens(wallet.address, undefined, threshold);

    if (dustTokens.length === 0) {
      await ctx.reply(
        `🧹 No dust tokens found in your agent wallet.\n\n` +
          `Send tokens to:\n\`${wallet.address}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    let msg = `🗑️ *Dust in your agent wallet:*\n\n`;
    let total = 0;
    for (const token of dustTokens) {
      msg += `• *${token.symbol}*: $${token.usdValue.toFixed(2)}\n`;
      total += token.usdValue;
    }
    msg += `\n💰 *Total:* $${total.toFixed(2)}`;
    msg += `\n_Dust threshold: $${threshold} — change with /setdust_`;
    msg += `\n\n_Paste a paywalled URL to spend this dust!_`;

    await ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (error: any) {
    await ctx.reply(`❌ Error scanning wallet: ${error.message}`);
  }
});

// Keep /setwallet as a helpful redirect — users don't need it anymore
bot.command("setwallet", async (ctx) => {
  const wallet = UserWalletStore.get(ctx.from.id);
  const addr = wallet?.address || "(not created yet — send /start)";
  await ctx.reply(
    `ℹ️ You don't need to set a wallet manually anymore!\n\n` +
      `Your dedicated agent wallet is:\n\`${addr}\`\n\n` +
      `Send your dust tokens there, then paste a paywalled URL.`,
    { parse_mode: "Markdown" }
  );
});

// ——————————————————————————————————
// /setdust — Per-user dust threshold configuration
// ——————————————————————————————————
bot.command("setdust", async (ctx) => {
  const wallet = UserWalletStore.get(ctx.from.id);
  if (!wallet) {
    await ctx.reply("❌ No wallet yet. Send /start first.");
    return;
  }

  // Parse the argument: /setdust 5  or  /setdust 2.5
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length === 0) {
    const current = UserWalletStore.getDustThreshold(ctx.from.id);
    await ctx.reply(
      `⚙️ *Dust Threshold Setting*\n\n` +
        `Current: *$${current}* per token\n` +
        `Default: *$${DEFAULT_DUST_THRESHOLD_USD}*\n\n` +
        `Tokens *below* this value are swept as dust when paying.\n\n` +
        `To change: /setdust \`<amount>\`\n` +
        `Examples: /setdust 2  /setdust 10  /setdust 50`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const value = parseFloat(args[0]);
  if (isNaN(value) || value < 0.5 || value > 500) {
    await ctx.reply("❌ Please enter a value between *$0.5* and *$500*.\nExample: /setdust 5", { parse_mode: "Markdown" });
    return;
  }

  UserWalletStore.setDustThreshold(ctx.from.id, value);
  await ctx.reply(
    `✅ Dust threshold updated to *$${value}*!\n\n` +
      `Tokens worth less than $${value} will now be swept automatically.\n` +
      `Use /dust to see what qualifies.`,
    { parse_mode: "Markdown" }
  );
});

// ——————————————————————————————————
// /history — On-chain transaction history (okx-audit-log skill)
// ——————————————————————————————————
bot.command("history", async (ctx) => {
  const wallet = UserWalletStore.get(ctx.from.id);
  if (!wallet) {
    await ctx.reply("❌ No wallet yet. Send /start first.");
    return;
  }

  await ctx.reply("📋 Fetching your on-chain sweep history via OKX Audit Log...");

  try {
    const records = await AuditLog.getTransactions(wallet.address, 10);
    const msg = AuditLog.formatForTelegram(records, wallet.address);
    await ctx.reply(msg, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
  } catch (err: any) {
    await ctx.reply(`❌ Failed to fetch history: ${err.message}`);
  }
});

// ——————————————————————————————————
// URL Handler — NLP Intent Parser + x402 Paywall Detection
// ——————————————————————————————————
bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  // ——— Phase 0: Parse natural language intent via Groq LLM ———
  const intent = await IntentParser.parse(text);

  // Route non-URL intents to their handlers
  if (intent.type === "check_dust") {
    ctx.message.text = "/dust"; // reuse /dust handler logic
    if (intent.friendlyAck) await ctx.reply(`💬 ${intent.friendlyAck}`);
    const wallet = UserWalletStore.get(ctx.from.id);
    if (!wallet) { await ctx.reply("Send /start first to set up your agent wallet."); return; }
    await ctx.reply("🔍 Scanning your agent wallet for dust tokens...");
    try {
      const dustTokens = await WalletScanner.getDustTokens(wallet.address, undefined, UserWalletStore.getDustThreshold(ctx.from.id));
      if (dustTokens.length === 0) {
        await ctx.reply(`🧹 No dust tokens found in your agent wallet.\n\nSend tokens to:\n\`${wallet.address}\``, { parse_mode: "Markdown" });
        return;
      }
      let msg = `🗑️ *Dust in your agent wallet:*\n\n`;
      let total = 0;
      for (const token of dustTokens) { msg += `• *${token.symbol}*: $${token.usdValue.toFixed(2)}\n`; total += token.usdValue; }
      msg += `\n💰 *Total:* $${total.toFixed(2)}\n\n_Paste a paywalled URL to spend this dust!_`;
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (e: any) { await ctx.reply(`❌ Error scanning: ${e.message}`); }
    return;
  }

  if (intent.type === "check_wallet") {
    if (intent.friendlyAck) await ctx.reply(`💬 ${intent.friendlyAck}`);
    ctx.message.text = "/wallet";
    const wallet = UserWalletStore.get(ctx.from.id);
    if (wallet) {
      const explorerUrl = `${networkConfig.explorerUrl}/address/${wallet.address}`;
      await ctx.reply(`💰 *Your Agent Wallet*\n\n📬 Address: \`${wallet.address}\`\n🔗 [View on explorer](${explorerUrl})`, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
    } else {
      await ctx.reply("❌ No wallet yet. Send /start to set one up.");
    }
    return;
  }

  if (intent.type === "help") {
    await ctx.reply(
      `🧹 *ZeroWaste Protocol*\n\nI convert your wallet's dust tokens into USDT payments for paywalled content.\n\n*Commands:* /start · /wallet · /dust · /help\n\n*To pay:* Just paste a paywalled URL and I'll handle the rest!`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // If intent is pay_url, use the LLM-extracted URL; otherwise fall back to regex
  let url: string;
  if (intent.type === "pay_url" && intent.url) {
    url = intent.url;
    if (intent.friendlyAck) {
      await ctx.reply(`💬 ${intent.friendlyAck}`);
    }
  } else {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) return;
    url = urlMatch[0];
  }

  // Ensure user has a wallet
  let userWallet = UserWalletStore.get(ctx.from.id);
  if (!userWallet) {
    await ctx.reply(
      "👋 Welcome! Setting up your agent wallet first...",
      { parse_mode: "Markdown" }
    );
    userWallet = await getOrCreateWallet(ctx, ctx.from.id);
    if (!userWallet) return;
    await ctx.reply(
      `✅ Agent wallet created: \`${userWallet.address}\`\n\n` +
        `Send dust tokens + OKB (gas) there, then paste the URL again.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.reply(`🔗 Checking paywall at:\n${url}`);

  try {
    // ——— Phase 1: Read the Paywall (x402 Detection) ———
    let paywallData: any;
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status === 402 || status === 200,
      });
      if (response.status === 200) {
        await ctx.reply("✅ This URL is already accessible — no payment needed!");
        return;
      }
      paywallData = response.data;
    } catch (err: any) {
      await ctx.reply(`❌ Could not reach the URL: ${err.message}`);
      return;
    }

    if (!paywallData.accepts || paywallData.accepts.length === 0) {
      await ctx.reply("❌ This URL returned a 402 but doesn't follow x402 standard.");
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
        `🔍 Scanning your agent wallet for dust...`,
      { parse_mode: "Markdown" }
    );

    // ——— Phase 2: Scan Dust + Security Filter + Live Price Enrichment ———
    let dustTokens = await WalletScanner.getDustTokens(userWallet.address, undefined, UserWalletStore.getDustThreshold(ctx.from.id));

    // okx-security: filter out risk tokens before attempting any swaps
    const { safe: safeTokens, risky } = TxSimulator.filterRiskTokens(dustTokens);
    if (risky.length > 0) {
      console.log(`[Bot] Filtered ${risky.length} risk token(s): ${risky.map(r => r.token.symbol).join(", ")}`);
    }
    dustTokens = safeTokens;

    // okx-dex-token: enrich prices with live DEX quotes for accuracy
    dustTokens = await TokenEnricher.enrichWithLivePrices(dustTokens, targetToken);

    if (dustTokens.length === 0) {
      await ctx.reply(
        `😔 *No dust found in your agent wallet!*\n\n` +
          `Send tokens to:\n\`${userWallet.address}\`\n\n` +
          `Also send ≥ 0.002 OKB for gas.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // ——— Fast path: agent wallet already holds the target token (USDT) ———
    const targetTokenInWallet = dustTokens.find(
      (t) => t.tokenAddress.toLowerCase() === targetToken.toLowerCase()
    );
    if (targetTokenInWallet && targetTokenInWallet.usdValue >= parseFloat(priceUsd)) {
      const session: PaymentSession = {
        userId: ctx.from.id,
        signingKey: userWallet.privateKey ?? userWallet.accountId,
        walletAddress: userWallet.address,
        merchantUrl: url,
        priceUsd,
        priceRaw,
        merchantAddress,
        targetToken,
        targetDecimals,
        dustBasket: [targetTokenInWallet],
        swapRoutes: [],
        tokensWithAmounts: [],
        totalDustValue: targetTokenInWallet.usdValue,
        directPaymentMode: true,
      };
      pendingSessions.set(ctx.from.id, session);

      await ctx.reply(
        `💰 *Direct USDT Payment!*\n\n` +
          `Your agent wallet has *$${targetTokenInWallet.usdValue.toFixed(2)} USDT* — no swap needed.\n\n` +
          `*Paying:* $${priceUsd} USDT\n` +
          `*From:* \`${userWallet.address.slice(0, 6)}...${userWallet.address.slice(-4)}\`\n` +
          `*To:* \`${merchantAddress}\`\n\n` +
          `⚡ _Direct transfer — zero DEX hops_\n` +
          `🔒 _Secured by OKX Onchain OS TEE_`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🟢 Pay $${priceUsd} USDT`, "approve_payment")],
            [Markup.button.callback("❌ Cancel", "cancel_payment")],
          ]),
        }
      );
      return;
    }

    // ——— Dust sweep path: route non-USDT dust through DEX ———
    const basket = WalletScanner.selectDustBasket(dustTokens, parseFloat(priceUsd));
    if (!basket.sufficient) {
      await ctx.reply(
        `😔 *Insufficient dust!*\n\n` +
          `Need: *$${priceUsd}*\n` +
          `Available: *$${basket.totalValue.toFixed(2)}*\n\n` +
          `Send more tokens to your agent wallet:\n\`${userWallet.address}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const TARGET_BUFFER = 1.05;
    const targetWithBuffer = parseFloat(priceUsd) * TARGET_BUFFER;

    let finalUsdtUsedFromBalance = 0;
    let finalSwapRoutes: SwapRoute[] = [];
    let finalTokensWithAmounts: { token: TokenAsset; amountRaw?: string }[] = [];

    let fallbackAttempt = 0;
    const blocklistedTokenAddresses = new Set<string>();

    while (fallbackAttempt < 5) {
      fallbackAttempt++;

      const eligibleDust = dustTokens.filter(
        (t) =>
          !blocklistedTokenAddresses.has(t.tokenAddress.toLowerCase()) &&
          t.tokenAddress.toLowerCase() !== targetToken.toLowerCase()
      );
      const attempt = WalletScanner.selectDustBasket(eligibleDust, parseFloat(priceUsd));

      if (!attempt.sufficient && fallbackAttempt === 1) {
        await ctx.reply(
          `😔 *Insufficient swappable dust!*\n\nNeed: *$${priceUsd}*\nAvailable: *$${attempt.totalValue.toFixed(2)}*`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      let remainingToCollect = targetWithBuffer;
      const currentTokensToRoute: { token: TokenAsset; amountRaw?: string }[] = [];
      let currentUsdtFromBalance = 0;

      for (const token of attempt.selected) {
        if (remainingToCollect <= 0) break;
        const isTargetToken =
          token.tokenAddress?.toLowerCase() === targetToken.toLowerCase();

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
          const rawPartialAmount = ethers
            .parseUnits(amountNeededFloat.toFixed(token.decimals), token.decimals)
            .toString();
          currentTokensToRoute.push({ token, amountRaw: rawPartialAmount });
          remainingToCollect = 0;
        }
      }

      if (currentTokensToRoute.length === 0) {
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = [];
        finalTokensWithAmounts = [];
        break;
      }

      console.log(
        `[Bot] Routing attempt #${fallbackAttempt}: ${currentTokensToRoute.map((t) => t.token.symbol).join(", ")}`
      );

      const { routes, failures } = await SwapRouter.getSwapRoutes(
        currentTokensToRoute,
        userWallet.address,
        targetToken,
        true // routeViaContract — calldata uses contract as msg.sender
      );

      if (failures.length === 0) {
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = routes;
        finalTokensWithAmounts = currentTokensToRoute;
        break;
      }

      console.log(
        `[Bot] Routing failure for ${failures.map((f) => f.symbol).join(", ")}. Retrying...`
      );
      for (const fail of failures) {
        const failToken = currentTokensToRoute.find((t) => t.token.symbol === fail.symbol);
        if (failToken)
          blocklistedTokenAddresses.add(failToken.token.tokenAddress.toLowerCase());
      }

      const batchOutput =
        currentUsdtFromBalance +
        routes.reduce((s, r) => s + parseFloat(r.estimatedOutputUsd), 0);
      if (batchOutput >= parseFloat(priceUsd)) {
        finalUsdtUsedFromBalance = currentUsdtFromBalance;
        finalSwapRoutes = routes;
        finalTokensWithAmounts = currentTokensToRoute.filter(
          (t) => !failures.find((f) => f.symbol === t.token.symbol)
        );
        break;
      }
    }

    const totalEstimatedOutput =
      finalUsdtUsedFromBalance +
      finalSwapRoutes.reduce((sum, r) => sum + parseFloat(r.estimatedOutputUsd), 0);

    if (totalEstimatedOutput < parseFloat(priceUsd)) {
      await ctx.reply(
        `⚠️ *Routing Failure*\n\n` +
          `DEX Aggregator rejected your tokens — amounts too small for safe swap on X Layer Mainnet.\n\n` +
          `Try adding more dust to your agent wallet:\n\`${userWallet.address}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const session: PaymentSession = {
      userId: ctx.from.id,
      signingKey: userWallet.privateKey ?? userWallet.accountId,
      walletAddress: userWallet.address,
      merchantUrl: url,
      priceUsd,
      priceRaw,
      merchantAddress,
      targetToken,
      targetDecimals,
      dustBasket: basket.selected,
      swapRoutes: finalSwapRoutes,
      tokensWithAmounts: finalTokensWithAmounts,
      totalDustValue: basket.totalValue,
    };
    pendingSessions.set(ctx.from.id, session);

    // ——— Phase 3: Show the Proposal ———
    let proposalMsg = `🧹 *Dust Sweep Proposal*\n\n`;
    proposalMsg += `*Paying:* $${priceUsd} USDT\n`;
    proposalMsg += `*From your agent wallet:* \`${userWallet.address.slice(0, 6)}...${userWallet.address.slice(-4)}\`\n\n`;
    proposalMsg += `*Dust to liquidate:*\n`;

    if (finalUsdtUsedFromBalance > 0) {
      proposalMsg += `  • USDT (direct): ~$${finalUsdtUsedFromBalance.toFixed(2)}\n`;
    }
    for (const route of finalSwapRoutes) {
      const tokenWithAmount = finalTokensWithAmounts.find(
        (t) => t.token.symbol === route.inputToken.symbol
      );
      const isPartial = !!tokenWithAmount?.amountRaw;
      const displayAmount = isPartial
        ? ethers.formatUnits(tokenWithAmount!.amountRaw!, route.inputToken.decimals)
        : route.inputToken.balance;
      proposalMsg += `  • ${route.inputToken.symbol} (${parseFloat(displayAmount).toFixed(6)}): $${(
        parseFloat(displayAmount) * parseFloat(route.inputToken.tokenPrice)
      ).toFixed(2)} → ~$${route.estimatedOutputUsd} USDT\n`;
    }

    proposalMsg += `\n*Total estimated output:* $${totalEstimatedOutput.toFixed(2)} USDT\n`;
    proposalMsg += `*Merchant receives:* $${priceUsd} USDT\n`;

    const refund = totalEstimatedOutput - parseFloat(priceUsd);
    if (refund > 0.001) {
      proposalMsg += `*Refund to you:* ~$${refund.toFixed(2)} USDT\n`;
    }

    proposalMsg += `\n⚡ _${finalSwapRoutes.length} swap(s) → atomic contract → merchant paid_\n`;
    proposalMsg += `🔒 _Secured by DustSweeper contract + OKX Onchain OS TEE_`;

    await ctx.reply(proposalMsg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🟢 Approve & Pay with Dust", "approve_payment")],
        [Markup.button.callback("❌ Cancel", "cancel_payment")],
      ]),
    });
  } catch (error: any) {
    console.error("[Bot] Error:", error);
    await ctx.reply(`❌ Something went wrong: ${error.message}`);
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
    await ctx.reply("❌ No pending payment found. Please paste the URL again.");
    return;
  }

  await ctx.editMessageText(
    "⏳ *Executing dust sweep...*\n\n🔄 Broadcasting to X Layer...",
    { parse_mode: "Markdown" }
  );

  try {
    const isMock = process.env.MOCK_MODE === "true";

    if (isMock) {
      // ——— MOCK EXECUTION ———
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const mockTxHash = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join("");

      try {
        await axios.post(
          `http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`,
          { txHash: mockTxHash }
        );
      } catch {}

      const explorerUrl = `${networkConfig.explorerUrl}/tx/${mockTxHash}`;
      await ctx.editMessageText(
        `✅ *Payment Successful!* 🎉\n\n` +
          `🧹 Swept ${session.swapRoutes.length} dust token(s)\n` +
          `💰 Paid $${session.priceUsd} USDT to merchant\n` +
          `⛓️ Network: ${networkConfig.networkName} (MOCK)\n` +
          `📄 Tx: \`${mockTxHash}\`\n\n` +
          `🔓 *Access your content:*\n${session.merchantUrl}?receipt=${mockTxHash}`,
        { parse_mode: "Markdown" }
      );
    } else if (session.directPaymentMode) {
      // ——— DIRECT USDT TRANSFER (agent wallet already holds USDT) ———
      console.log(
        `[Bot] Direct USDT transfer: ${session.walletAddress} → ${session.merchantAddress}, amount: ${session.priceRaw}`
      );

      const transferIface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);
      const transferData = transferIface.encodeFunctionData("transfer", [
        session.merchantAddress,
        BigInt(session.priceRaw),
      ]);

      const txHash = await AgenticWallet.sendTransactionForUser(
        session.signingKey,
        session.targetToken,
        transferData
      );
      await verifier.waitForConfirmationViaGateway(txHash, 60000);

      try {
        await axios.post(
          `http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`,
          { txHash }
        );
      } catch {}

      const explorerUrl = `${networkConfig.explorerUrl}/tx/${txHash}`;
      await ctx.editMessageText(
        `✅ *Payment Successful!* 🎉\n\n` +
          `💰 Paid $${session.priceUsd} USDT directly\n` +
          `📤 No swap needed — you had USDT!\n` +
          `⛓️ Network: ${networkConfig.networkName}\n` +
          `📄 Tx: [${txHash.slice(0, 10)}...](${explorerUrl})\n\n` +
          `🔓 *Access your content:*\n${session.merchantUrl}?receipt=${txHash}`,
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
      );
    } else {
      // ——— LIVE EXECUTION: Sequential swaps directly from user wallet → pay merchant ———
      // Each swap: approve DEX router + execute swap. Then transfer USDT to merchant.
      // Routes are re-fetched fresh here so calldata is not stale.
      console.log("[Bot] Re-fetching swap routes for fresh execution calldata...");
      const { routes: freshRoutes, failures: refetchFailures } = await SwapRouter.getSwapRoutes(
        session.tokensWithAmounts,
        session.walletAddress,
        session.targetToken,
        false // user wallet is msg.sender — standard OKX DEX flow
      );

      if (refetchFailures.length > 0 || freshRoutes.length === 0) {
        await ctx.editMessageText(
          `⚠️ *Routing refresh failed*\n\nCould not get fresh swap routes. Please try again.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const approveIface = new ethers.Interface([
        "function approve(address spender, uint256 amount) returns (bool)",
      ]);

      let swapCount = 0;
      const swapTxHashes: string[] = [];

      for (const route of freshRoutes) {
        swapCount++;
        const { token, amountRaw } = session.tokensWithAmounts.find(
          (t) => t.token.tokenAddress.toLowerCase() === route.inputToken.tokenAddress.toLowerCase()
        ) || { token: route.inputToken, amountRaw: undefined };

        await ctx.editMessageText(
          `⏳ *Sweeping dust... (${swapCount}/${freshRoutes.length})*\n\n` +
            `🔄 Swapping ${route.inputToken.symbol} → USDT on OKX DEX...`,
          { parse_mode: "Markdown" }
        );

        // Approve DEX router for this token
        if (route.approveData) {
          console.log(`[Bot] Approving DEX router for ${route.inputToken.symbol}...`);
          const approveTxHash = await AgenticWallet.sendTransactionForUser(
            session.signingKey,
            route.approveData.to,
            route.approveData.data
          );
          await verifier.waitForConfirmationViaGateway(approveTxHash, 30000);
          console.log(`[Bot] ✅ ${route.inputToken.symbol} approved`);
        }

        // Execute the swap
        console.log(`[Bot] Executing swap ${route.inputToken.symbol} → USDT...`);
        const swapTxHash = await AgenticWallet.sendTransactionForUser(
          session.signingKey,
          route.txData.to,
          route.txData.data,
          route.txData.value !== "0" ? route.txData.value : "0"
        );
        await verifier.waitForConfirmationViaGateway(swapTxHash, 60000);
        swapTxHashes.push(swapTxHash);
        console.log(`[Bot] ✅ Swap tx: ${swapTxHash}`);
      }

      await ctx.editMessageText(
        `⏳ *Paying merchant...*\n\n` +
          `✅ ${freshRoutes.length} swap(s) complete\n` +
          `🔄 Transferring $${session.priceUsd} USDT to merchant...`,
        { parse_mode: "Markdown" }
      );

      // Transfer USDT to merchant
      const transferIface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);
      const transferData = transferIface.encodeFunctionData("transfer", [
        session.merchantAddress,
        BigInt(session.priceRaw),
      ]);
      const payTxHash = await AgenticWallet.sendTransactionForUser(
        session.signingKey,
        session.targetToken,
        transferData
      );
      await verifier.waitForConfirmationViaGateway(payTxHash, 60000);
      console.log(`[Bot] ✅ Merchant paid: ${payTxHash}`);

      try {
        await axios.post(
          `http://localhost:${process.env.MERCHANT_PORT || "3001"}/confirm-payment`,
          { txHash: payTxHash }
        );
      } catch {}

      const explorerUrl = `${networkConfig.explorerUrl}/tx/${payTxHash}`;
      await ctx.editMessageText(
        `✅ *Payment Successful!* 🎉\n\n` +
          `🧹 Swept ${freshRoutes.length} dust token(s) via OKX DEX\n` +
          `💰 Paid $${session.priceUsd} USDT to merchant\n` +
          `⛓️ Network: ${networkConfig.networkName}\n` +
          `📄 Payment Tx: [${payTxHash.slice(0, 10)}...](${explorerUrl})\n\n` +
          `🔓 *Access your content:*\n${session.merchantUrl}?receipt=${payTxHash}`,
        {
          parse_mode: "Markdown",
          link_preview_options: { is_disabled: true },
        }
      );
    }

    pendingSessions.delete(userId);
  } catch (error: any) {
    console.error("[Bot] Payment execution error:", error);
    // Truncate the error — full calldata in error.message can exceed Telegram's 4096-char limit
    const shortMsg = (error.message as string).slice(0, 200);
    await ctx.reply(
      `❌ Payment failed: ${shortMsg}\n\nYour tokens are safe — the transaction was reverted.`
    );
  }
});

bot.action("cancel_payment", async (ctx) => {
  await ctx.answerCbQuery("Payment cancelled.");
  pendingSessions.delete(ctx.from!.id);
  await ctx.editMessageText("❌ Payment cancelled. Your dust is safe!");
});

bot.help((ctx) => {
  ctx.reply(
    `🧹 *ZeroWaste Protocol — Commands*\n\n` +
      `/start — Set up your agent wallet\n` +
      `/wallet — Show your agent wallet address (deposit address)\n` +
      `/dust — View dust tokens in your agent wallet\n` +
      `/help — This message\n\n` +
      `*How it works:*\n` +
      `1. Get your agent wallet via /start\n` +
      `2. Send dust tokens + OKB (gas) to it\n` +
      `3. Paste any paywalled URL\n` +
      `4. Approve — I sweep dust → pay merchant → unlock content\n\n` +
      `_Built on X Layer with OKX Onchain OS_ ⛓️`,
    { parse_mode: "Markdown" }
  );
});

// ——————————————————————————————————
// Launch Bot
// ——————————————————————————————————
bot.launch().then(() => {
  console.log("\n🤖 ZeroWaste Protocol bot is running!");
  console.log("   Send /start in Telegram to begin.\n");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
