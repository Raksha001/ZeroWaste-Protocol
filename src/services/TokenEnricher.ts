/**
 * TokenEnricher.ts — okx-dex-token skill
 *
 * Enriches dust tokens with live DEX prices from OKX before basket selection.
 * The Portfolio API prices can be slightly stale; DEX quote prices are real-time.
 *
 * Flow: getDustTokens() → enrichWithLivePrices() → selectDustBasket()
 *
 * OKX endpoint used: GET /api/v6/dex/aggregator/quote (price quote without tx data)
 */
import { okxApi } from "./OkxApiClient";
import { networkConfig } from "../config/network";
import { TokenAsset } from "./WalletScanner";

export class TokenEnricher {
  /**
   * Enriches token list with live DEX-quoted prices (okx-dex-token skill).
   * For each non-USDT token, fetches a DEX quote to USDT to get live USD value.
   * Falls back to portfolio price if the DEX quote fails.
   *
   * OKX DEX Quote endpoint: /api/v6/dex/aggregator/quote
   */
  static async enrichWithLivePrices(
    tokens: TokenAsset[],
    targetTokenAddress: string
  ): Promise<TokenAsset[]> {
    if (process.env.MOCK_MODE === "true") return tokens;

    console.log(`[TokenEnricher] Fetching live DEX prices for ${tokens.length} dust tokens...`);

    const enriched = await Promise.all(
      tokens.map(async (token): Promise<TokenAsset> => {
        // Skip if this token IS the target (USDT) — price is always ~$1
        if (token.tokenAddress.toLowerCase() === targetTokenAddress.toLowerCase()) {
          return token;
        }

        try {
          const response = await okxApi.get("/api/v6/dex/aggregator/quote", {
            chainIndex: networkConfig.chainId.toString(),
            fromTokenAddress: token.tokenAddress,
            toTokenAddress: targetTokenAddress,
            amount: token.rawBalance,
          });

          if (response.code === "0" && response.data?.[0]) {
            const quoteData = response.data[0];
            const toAmount = quoteData.routerResult?.toTokenAmount || quoteData.toTokenAmount;

            if (toAmount) {
              // USDT has 6 decimals → convert raw to USD
              const liveUsdValue = parseFloat(toAmount) / 1e6;

              if (liveUsdValue > 0) {
                const livePrice = (liveUsdValue / parseFloat(token.balance)).toFixed(8);
                const delta = Math.abs(token.usdValue - liveUsdValue) / token.usdValue;

                // Always log so validation is visible in console
                if (delta > 0.02) {
                  console.log(
                    `[TokenEnricher] 📊 ${token.symbol} price UPDATED: ` +
                    `$${token.usdValue.toFixed(4)} (portfolio) → $${liveUsdValue.toFixed(4)} (DEX live) [${(delta * 100).toFixed(1)}% diff]`
                  );
                } else {
                  console.log(
                    `[TokenEnricher] ✅ ${token.symbol} DEX quote: $${liveUsdValue.toFixed(4)} ` +
                    `(portfolio: $${token.usdValue.toFixed(4)}, within ${(delta * 100).toFixed(2)}%)`
                  );
                }

                return {
                  ...token,
                  tokenPrice: livePrice,
                  usdValue: liveUsdValue,
                };
              }
            }
          }
        } catch (err: any) {
          // Non-blocking — keep portfolio price if DEX quote fails
          console.warn(`[TokenEnricher] Quote failed for ${token.symbol}: ${err.message}`);
        }

        return token; // fallback: portfolio price unchanged
      })
    );

    return enriched.sort((a, b) => b.usdValue - a.usdValue); // re-sort after price update
  }
}
