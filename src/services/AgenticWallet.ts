/**
 * AgenticWallet.ts — okx-agentic-wallet skill
 *
 * Dual-mode execution:
 *  - Cloud/Railway: ethers.js direct signing (via AGENT_PRIVATE_KEY or per-user privateKey)
 *  - Local dev: onchainos CLI signing (via ONCHAINOS_PATH + accountId)
 *
 * Automatically detects which mode to use based on what's available.
 */
import { exec } from "child_process";
import { promisify } from "util";
import { ethers } from "ethers";
import { networkConfig } from "../config/network";

const execAsync = promisify(exec);

// ——————————————————————————————————
// Mutex — onchainos `wallet switch` is process-global state.
// Not needed for ethers.js path (each wallet is independent).
// ——————————————————————————————————
let mutexLocked = false;
const mutexQueue: Array<() => void> = [];

async function acquireMutex(): Promise<void> {
  if (!mutexLocked) { mutexLocked = true; return; }
  return new Promise((resolve) => mutexQueue.push(resolve));
}

function releaseMutex(): void {
  const next = mutexQueue.shift();
  if (next) { next(); } else { mutexLocked = false; }
}

/** Returns true if the value looks like an Ethereum private key */
function isPrivateKey(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export class AgenticWallet {
  /**
   * Execute a contract call for a specific user.
   *
   * @param accountIdOrKey  Either:
   *   - A private key (0x + 64 hex chars) → signs via ethers.js directly
   *   - An onchainos accountId (UUID) → signs via onchainos CLI
   */
  static async sendTransactionForUser(
    accountIdOrKey: string,
    to: string,
    data: string,
    value: string = "0"
  ): Promise<string> {
    if (isPrivateKey(accountIdOrKey)) {
      return AgenticWallet._sendWithEthers(accountIdOrKey, to, data, value);
    }
    return AgenticWallet._sendWithOnchainos(accountIdOrKey, to, data, value);
  }

  /**
   * Execute a contract call using the default agent wallet.
   * Prefers AGENT_PRIVATE_KEY (cloud), falls back to AGENT_ACCOUNT_ID (local).
   */
  static async sendTransaction(
    to: string,
    data: string,
    value: string = "0"
  ): Promise<string> {
    const privateKey = process.env.AGENT_PRIVATE_KEY;
    if (privateKey) {
      return AgenticWallet._sendWithEthers(privateKey, to, data, value);
    }
    const accountId = process.env.AGENT_ACCOUNT_ID;
    if (!accountId) {
      throw new Error("Neither AGENT_PRIVATE_KEY nor AGENT_ACCOUNT_ID is set in .env");
    }
    return AgenticWallet._sendWithOnchainos(accountId, to, data, value);
  }

  /**
   * Native token transfer for a specific user account.
   */
  static async sendNativeForUser(
    accountIdOrKey: string,
    to: string,
    amountRaw: string
  ): Promise<string> {
    if (isPrivateKey(accountIdOrKey)) {
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const wallet = new ethers.Wallet(accountIdOrKey, provider);
      const tx = await wallet.sendTransaction({ to, value: BigInt(amountRaw) });
      console.log(`[AgenticWallet] Native send tx: ${tx.hash}`);
      await tx.wait(1);
      return tx.hash;
    }

    const chainId = networkConfig.chainId.toString();
    const onchainosPath = process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    await acquireMutex();
    try {
      await execAsync(`${onchainosPath} wallet switch ${accountIdOrKey}`);
      const cmd = `${onchainosPath} wallet send --recipient ${to} --chain ${chainId} --amt ${amountRaw} --force`;
      console.log(`[AgenticWallet] Native send (account ${accountIdOrKey.slice(0, 8)}...): ${cmd}`);
      const { stdout } = await execAsync(cmd);
      return AgenticWallet._extractTxHash(stdout, "");
    } finally {
      releaseMutex();
    }
  }

  // ─── Private: ethers.js path (cloud / Railway) ───────────────────────────

  private static async _sendWithEthers(
    privateKey: string,
    to: string,
    data: string,
    value: string
  ): Promise<string> {
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`[AgenticWallet] Signing with ethers.js (${wallet.address.slice(0, 10)}...)`);

    const tx = await wallet.sendTransaction({
      to,
      data,
      value: value !== "0" ? BigInt(value) : 0n,
    });

    console.log(`[AgenticWallet] Tx sent: ${tx.hash}`);
    await tx.wait(1);
    return tx.hash;
  }

  // ─── Private: onchainos CLI path (local dev) ──────────────────────────────

  private static async _sendWithOnchainos(
    accountId: string,
    to: string,
    data: string,
    value: string
  ): Promise<string> {
    const chainId = networkConfig.chainId.toString();
    const onchainosPath = process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    await acquireMutex();
    try {
      console.log(`[AgenticWallet] Switching to account ${accountId}...`);
      await execAsync(`${onchainosPath} wallet switch ${accountId}`);

      let cmd = `${onchainosPath} wallet contract-call --to ${to} --chain ${chainId} --input-data ${data} --force`;
      if (value && value !== "0") cmd += ` --amt ${value}`;

      console.log(`[AgenticWallet] Executing (account ${accountId.slice(0, 8)}...): ${cmd}`);
      const { stdout, stderr } = await execAsync(cmd);
      return AgenticWallet._extractTxHash(stdout, stderr);
    } finally {
      releaseMutex();
    }
  }

  private static _extractTxHash(stdout: string, stderr: string): string {
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
