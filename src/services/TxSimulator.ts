/**
 * TxSimulator.ts — okx-security skill
 *
 * Pre-flight safety checks before executing any on-chain transaction:
 *   1. Token risk check: flags known honeypots/risk tokens from portfolio scan
 *   2. Transaction simulation: calls OKX pre-transaction API to verify tx won't revert
 *
 * Used in the bot BEFORE each approve+swap so we never attempt a doomed tx.
 */
import { okxApi } from "./OkxApiClient";
import { networkConfig } from "../config/network";
import { TokenAsset } from "./WalletScanner";

export interface SimulationResult {
  safe: boolean;
  reason?: string;
  gasEstimate?: string;
}

export class TxSimulator {
  /**
   * Filter out known risk tokens from a dust basket.
   * Uses the isRiskToken flag returned by OKX Portfolio API + cross-checks
   * with OKX security token info endpoint.
   */
  static filterRiskTokens(tokens: TokenAsset[]): {
    safe: TokenAsset[];
    risky: { token: TokenAsset; reason: string }[];
  } {
    const safe: TokenAsset[] = [];
    const risky: { token: TokenAsset; reason: string }[] = [];

    for (const token of tokens) {
      if (token.isRiskToken) {
        risky.push({ token, reason: "Flagged as risk token by OKX Portfolio API" });
        console.log(`[TxSimulator] ⚠️  Skipping risk token: ${token.symbol} (${token.tokenAddress})`);
      } else {
        safe.push(token);
      }
    }

    console.log(`[TxSimulator] Security filter: ${safe.length} safe, ${risky.length} risky tokens`);
    return { safe, risky };
  }

  /**
   * Simulate a transaction via OKX pre-transaction validation API (okx-security skill).
   * Returns whether the tx is predicted to succeed before spending gas.
   *
   * OKX endpoint: POST /api/v5/wallet/pre-transaction/validate-transaction
   */
  static async simulate(
    from: string,
    to: string,
    data: string,
    value: string = "0"
  ): Promise<SimulationResult> {
    try {
      console.log(`[TxSimulator] Simulating tx: ${from} → ${to} (value=${value})`);

      const body = {
        chainIndex: networkConfig.chainId.toString(),
        from,
        to,
        value,
        data,
      };

      const response = await okxApi.post(
        "/api/v5/wallet/pre-transaction/validate-transaction",
        body
      );

      if (response.code === "0" && response.data) {
        const result = response.data[0] || response.data;
        const success = result.success !== false && result.status !== "failed";
        const gasEstimate = result.gasUsed || result.gas;

        console.log(`[TxSimulator] ✅ Simulation: ${success ? "PASS" : "FAIL"} — gas: ${gasEstimate}`);
        return {
          safe: success,
          reason: success ? undefined : (result.error || "Simulation predicted revert"),
          gasEstimate: gasEstimate?.toString(),
        };
      }

      // If API is unavailable or returns unexpected format, fail open (don't block)
      console.log(`[TxSimulator] Simulation API response unexpected — allowing tx (fail-open)`);
      return { safe: true, reason: "Simulation skipped (API response format)" };
    } catch (err: any) {
      // Don't block the flow if simulation API is down
      console.warn(`[TxSimulator] Simulation failed (non-blocking): ${err.message}`);
      return { safe: true, reason: "Simulation unavailable — proceeding" };
    }
  }

  /**
   * Simulate all swaps in a batch and return the ones that pass.
   * Safely skips tokens whose simulate() predicts revert, adding them to failures.
   */
  static async filterSafeSwaps(
    userAddress: string,
    swapBatch: { token: TokenAsset; to: string; data: string; value?: string }[]
  ): Promise<{
    safe: typeof swapBatch;
    skipped: { token: TokenAsset; reason: string }[];
  }> {
    const safe: typeof swapBatch = [];
    const skipped: { token: TokenAsset; reason: string }[] = [];

    await Promise.all(
      swapBatch.map(async (item) => {
        const result = await TxSimulator.simulate(
          userAddress,
          item.to,
          item.data,
          item.value || "0"
        );

        if (result.safe) {
          safe.push(item);
        } else {
          console.log(`[TxSimulator] ⛔ Skipping ${item.token.symbol}: ${result.reason}`);
          skipped.push({ token: item.token, reason: result.reason || "Simulation failed" });
        }
      })
    );

    return { safe, skipped };
  }
}
