import { ethers } from "ethers";
import dotenv from "dotenv";
import { networkConfig } from "../config/network";
import { okxApi } from "./OkxApiClient";

dotenv.config();

// Polling interval for OKX gateway tracking
const GATEWAY_POLL_INTERVAL_MS = 3000;

/**
 * Verifies payment transactions on X Layer.
 *
 * Onchain OS Skill: okx-onchain-gateway (conceptual — we use ethers + RPC directly)
 */
export class PaymentVerifier {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  }

  /**
   * Wait for a transaction to be mined and return the receipt.
   * Times out after maxWaitMs (default 60 seconds).
   */
  async waitForConfirmation(txHash: string, maxWaitMs: number = 60000): Promise<{
    success: boolean;
    blockNumber?: number;
    gasUsed?: string;
    error?: string;
  }> {
    console.log(`[PaymentVerifier] Waiting for tx ${txHash} confirmation on X Layer...`);

    try {
      const receipt = await Promise.race([
        this.provider.waitForTransaction(txHash, 1),   // 1 confirmation
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), maxWaitMs)
        ),
      ]);

      if (!receipt) {
        return { success: false, error: "No receipt returned" };
      }

      if (receipt.status === 1) {
        console.log(`[PaymentVerifier] ✅ Tx confirmed in block ${receipt.blockNumber}`);
        return {
          success: true,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
        };
      } else {
        return { success: false, error: "Transaction reverted on-chain" };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify that a specific USDT transfer event occurred in a transaction.
   */
  async verifyUsdtTransfer(
    txHash: string,
    expectedRecipient: string,
    expectedAmountMin: bigint
  ): Promise<boolean> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) return false;

      // ERC20 Transfer event signature: Transfer(address,address,uint256)
      const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

      for (const log of receipt.logs) {
        if (log.topics[0] === TRANSFER_TOPIC) {
          const to = "0x" + log.topics[2].slice(26);         // Extract recipient from topic
          const amount = BigInt(log.data);                    // Amount from data field

          if (
            to.toLowerCase() === expectedRecipient.toLowerCase() &&
            amount >= expectedAmountMin
          ) {
            console.log(`[PaymentVerifier] ✅ Verified USDT transfer of ${amount} to ${to}`);
            return true;
          }
        }
      }

      return false;
    } catch (error: any) {
      console.error("[PaymentVerifier] Verification error:", error.message);
      return false;
    }
  }

  /**
   * Track a transaction via OKX Onchain Gateway API (okx-onchain-gateway skill).
   * Polls until the tx is confirmed or timeout is reached.
   *
   * OKX endpoint: GET /api/v5/wallet/post-transaction/transaction-detail-by-txhash
   */
  async waitForConfirmationViaGateway(
    txHash: string,
    maxWaitMs: number = 90000
  ): Promise<{ success: boolean; blockNumber?: number; error?: string }> {
    console.log(`[PaymentVerifier:Gateway] Tracking tx ${txHash} via OKX Onchain Gateway...`);
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      try {
        const response = await okxApi.get(
          "/api/v5/wallet/post-transaction/transaction-detail-by-txhash",
          {
            chainIndex: networkConfig.chainId.toString(),
            txHash: txHash,    // OKX API uses camelCase
          }
        );

        if (response.code === "0" && response.data?.[0]) {
          const detail = response.data[0];
          const status = detail.txStatus || detail.status;
          const blockNum = detail.blockNumber || detail.height;

          if (status === "success" || status === "1" || status === 1) {
            console.log(`[PaymentVerifier:Gateway] ✅ Confirmed via OKX Gateway — block ${blockNum}`);
            return { success: true, blockNumber: parseInt(blockNum) };
          }

          if (status === "failed" || status === "0" || status === 0) {
            console.log(`[PaymentVerifier:Gateway] ❌ Tx failed on-chain`);
            return { success: false, error: "Transaction reverted on-chain" };
          }

          console.log(`[PaymentVerifier:Gateway] Status: ${status} — polling again...`);
        }
      } catch (err: any) {
        // If gateway is down, fall back to ethers confirmation
        console.warn(`[PaymentVerifier:Gateway] API error: ${err.message} — falling back to ethers`);
        return this.waitForConfirmation(txHash, Math.max(deadline - Date.now(), 5000));
      }

      await new Promise(r => setTimeout(r, GATEWAY_POLL_INTERVAL_MS));
    }

    // Timeout — fall back to ethers as last resort
    console.warn(`[PaymentVerifier:Gateway] Timeout — falling back to ethers confirmation`);
    return this.waitForConfirmation(txHash, 15000);
  }

  /**
   * Get the current block number (health check).
   */
  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }
}
