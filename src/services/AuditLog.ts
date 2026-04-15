/**
 * AuditLog.ts — okx-audit-log skill
 *
 * Queries on-chain transaction history for a user's agent wallet using the
 * OKX post-transaction list API. Powers the /history command in the bot,
 * giving users a verifiable, immutable log of all ZeroWaste sweep payments.
 *
 * OKX endpoint: GET /api/v5/wallet/post-transaction/list-transactions-by-address
 */
import { okxApi } from "./OkxApiClient";
import { networkConfig } from "../config/network";

export interface TxRecord {
  txHash: string;
  txTime: string;
  txStatus: string;  // "success" | "failed" | "pending"
  symbol?: string;
  amount?: string;
  txType?: string;   // "send" | "receive" | "contract-call"
  explorerUrl: string;
}

export class AuditLog {
  /**
   * Fetch recent on-chain transactions for an address (okx-audit-log skill).
   * OKX endpoint: GET /api/v5/wallet/post-transaction/list-transactions-by-address
   */
  static async getTransactions(
    address: string,
    limit: number = 10
  ): Promise<TxRecord[]> {
    console.log(`[AuditLog] Fetching on-chain history for ${address}...`);

    try {
      const response = await okxApi.get(
        "/api/v5/wallet/post-transaction/list-transactions-by-address",
        {
          address,
          chainIndex: networkConfig.chainId.toString(),
          limit: limit.toString(),
        }
      );

      if (response.code !== "0") {
        console.warn(`[AuditLog] API returned code ${response.code}: ${response.msg}`);
        return [];
      }

      const rawList: any[] = response.data?.[0]?.transactionList || response.data || [];

      if (!Array.isArray(rawList) || rawList.length === 0) {
        console.log("[AuditLog] No transactions found.");
        return [];
      }

      return rawList.slice(0, limit).map((tx: any): TxRecord => ({
        txHash:     tx.txHash || tx.hash || "",
        txTime:     tx.txTime ? new Date(parseInt(tx.txTime)).toLocaleString() : "unknown",
        txStatus:   tx.txStatus || tx.status || "unknown",
        symbol:     tx.tokenSymbol || tx.symbol,
        amount:     tx.amount || tx.value,
        txType:     tx.txType || tx.type,
        explorerUrl: `${networkConfig.explorerUrl}/tx/${tx.txHash || tx.hash}`,
      }));
    } catch (err: any) {
      console.warn(`[AuditLog] Failed to fetch history (non-blocking): ${err.message}`);
      return [];
    }
  }

  /**
   * Format transaction history into a Telegram-friendly Markdown string.
   */
  static formatForTelegram(records: TxRecord[], walletAddress: string): string {
    const explorerBase = `${networkConfig.explorerUrl}/address/${walletAddress}`;

    if (records.length === 0) {
      return (
        `📋 *ZeroWaste Protocol — Transaction History*\n\n` +
        `No transactions found on X Layer for this wallet yet.\n\n` +
        `[View on Explorer](${explorerBase})`
      );
    }

    let msg = `📋 *ZeroWaste Protocol — Recent Activity*\n`;
    msg += `_Last ${records.length} on-chain transactions on X Layer:_\n\n`;

    for (const tx of records) {
      const statusEmoji = tx.txStatus === "success" ? "✅"
        : tx.txStatus === "failed" ? "❌"
        : "⏳";

      const hashShort = tx.txHash ? `${tx.txHash.slice(0, 8)}...${tx.txHash.slice(-6)}` : "?";
      msg += `${statusEmoji} [${hashShort}](${tx.explorerUrl})`;
      if (tx.symbol && tx.amount) msg += ` — ${tx.amount} ${tx.symbol}`;
      msg += `\n_${tx.txTime}_\n\n`;
    }

    msg += `[📊 Full History on Explorer](${explorerBase})`;
    return msg;
  }
}
