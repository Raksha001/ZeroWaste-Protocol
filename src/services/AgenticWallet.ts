import { exec } from "child_process";
import { promisify } from "util";
import { networkConfig } from "../config/network";

const execAsync = promisify(exec);

export class AgenticWallet {
  /**
   * Executes a contract call via Onchain OS Agentic Wallet (TEE).
   * Automatically handles signatures without exposing the private key.
   */
  static async sendTransaction(
    to: string,
    data: string,
    value: string = "0"
  ): Promise<string> {
    const chainId = networkConfig.chainId.toString();
    
    // Ensure onchainos CLI is accessible (tilde not expanded by execAsync — use HOME)
    const onchainosPath = process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    // Build the CLI command
    // --force is required to skip interactive confirmation
    let cmd = `${onchainosPath} wallet contract-call --to ${to} --chain ${chainId} --input-data ${data} --force`;
    
    if (value && value !== "0") {
      cmd += ` --amt ${value}`;
    }

    console.log(`[AgenticWallet] Executing: ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd);
      
      // The CLI outputs JSON if successful, or text output. We need to parse it.
      try {
        // Try parsing JSON output
        const result = JSON.parse(stdout.trim());
        if (result.ok && result.data?.txHash) {
          return result.data.txHash;
        }
      } catch (e) {
        // If it's not JSON, try to extract tx hash from stdout or just return the output
        console.log(`[AgenticWallet] Raw output:`, stdout);
      }
      
      // Fallback extraction logic based on expected CLI output format
      const txHashMatch = stdout.match(/0x[a-fA-F0-9]{64}/);
      if (txHashMatch) {
         return txHashMatch[0];
      }
      
      throw new Error(`Transaction failed or txHash not found in output: ${stdout || stderr}`);
    } catch (error: any) {
      console.error("[AgenticWallet] CLI error:", error.message);
      throw error;
    }
  }

  /**
   * Fast native transfer
   */
  static async sendNative(to: string, amountRaw: string): Promise<string> {
    const chainId = networkConfig.chainId.toString();
    const onchainosPath = process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;
    const cmd = `${onchainosPath} wallet send --recipient ${to} --chain ${chainId} --amt ${amountRaw} --force`;
    console.log(`[AgenticWallet] Executing: ${cmd}`);

    try {
      const { stdout } = await execAsync(cmd);
      const txHashMatch = stdout.match(/0x[a-fA-F0-9]{64}/);
      if (txHashMatch) {
         return txHashMatch[0];
      }
      throw new Error("Could not extract txHash from response");
    } catch (error: any) {
      throw error;
    }
  }
}
