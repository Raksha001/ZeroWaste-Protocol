import { exec } from "child_process";
import { promisify } from "util";
import { networkConfig } from "../config/network";

const execAsync = promisify(exec);

// ——————————————————————————————————
// Global mutex — onchainos `wallet switch` is process-global state.
// All switch+execute sequences must run atomically to prevent interleaving
// between concurrent user payments.
// ——————————————————————————————————
let mutexLocked = false;
const mutexQueue: Array<() => void> = [];

async function acquireMutex(): Promise<void> {
  if (!mutexLocked) {
    mutexLocked = true;
    return;
  }
  return new Promise((resolve) => mutexQueue.push(resolve));
}

function releaseMutex(): void {
  const next = mutexQueue.shift();
  if (next) {
    next();
  } else {
    mutexLocked = false;
  }
}

export class AgenticWallet {
  /**
   * Execute a contract call as a specific onchainos account.
   *
   * Safe for concurrent callers — internally serializes via mutex so that
   * wallet switch + contract-call run atomically.
   */
  static async sendTransactionForUser(
    accountId: string,
    to: string,
    data: string,
    value: string = "0"
  ): Promise<string> {
    const chainId = networkConfig.chainId.toString();
    const onchainosPath =
      process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    await acquireMutex();
    try {
      // Switch to the user's account
      console.log(`[AgenticWallet] Switching to account ${accountId}...`);
      await execAsync(`${onchainosPath} wallet switch ${accountId}`);

      // Execute the transaction
      let cmd = `${onchainosPath} wallet contract-call --to ${to} --chain ${chainId} --input-data ${data} --force`;
      if (value && value !== "0") cmd += ` --amt ${value}`;

      console.log(`[AgenticWallet] Executing (account ${accountId.slice(0, 8)}...): ${cmd}`);
      const { stdout, stderr } = await execAsync(cmd);

      return AgenticWallet.extractTxHash(stdout, stderr);
    } finally {
      releaseMutex();
    }
  }

  /**
   * Execute a contract call using the default agent wallet (AGENT_ACCOUNT_ID in .env).
   * Used for ops that don't belong to a specific user.
   */
  static async sendTransaction(
    to: string,
    data: string,
    value: string = "0"
  ): Promise<string> {
    const defaultAccountId = process.env.AGENT_ACCOUNT_ID;
    if (!defaultAccountId) {
      throw new Error(
        "AGENT_ACCOUNT_ID not set in .env — required for default wallet operations"
      );
    }
    return AgenticWallet.sendTransactionForUser(defaultAccountId, to, data, value);
  }

  /**
   * Native token transfer for a specific user account.
   */
  static async sendNativeForUser(
    accountId: string,
    to: string,
    amountRaw: string
  ): Promise<string> {
    const chainId = networkConfig.chainId.toString();
    const onchainosPath =
      process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    await acquireMutex();
    try {
      await execAsync(`${onchainosPath} wallet switch ${accountId}`);
      const cmd = `${onchainosPath} wallet send --recipient ${to} --chain ${chainId} --amt ${amountRaw} --force`;
      console.log(`[AgenticWallet] Native send (account ${accountId.slice(0, 8)}...): ${cmd}`);
      const { stdout } = await execAsync(cmd);
      return AgenticWallet.extractTxHash(stdout, "");
    } finally {
      releaseMutex();
    }
  }

  private static extractTxHash(stdout: string, stderr: string): string {
    try {
      const result = JSON.parse(stdout.trim());
      if (result.ok && result.data?.txHash) return result.data.txHash;
    } catch {
      // Not JSON — fall through
    }
    const match = stdout.match(/0x[a-fA-F0-9]{64}/);
    if (match) return match[0];
    throw new Error(`txHash not found in CLI output: ${stdout || stderr}`);
  }
}
