import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

export const DEFAULT_DUST_THRESHOLD_USD = 50.0;

export interface UserWallet {
  accountId: string;
  address: string;
  createdAt: string;
  dustThresholdUsd?: number; // per-user preference, defaults to DEFAULT_DUST_THRESHOLD_USD
}

// Persisted to .data/user-wallets.json so wallets survive bot restarts
// On Railway, we point this to /app/storage/data via USER_DATA_DIR
const DATA_DIR = process.env.USER_DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "user-wallets.json");

function loadStore(): Record<string, UserWallet> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

function saveStore(store: Record<string, UserWallet>): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

export class UserWalletStore {
  /**
   * Returns the wallet for a Telegram user, or null if they haven't set one up yet.
   */
  static get(telegramId: number): UserWallet | null {
    const store = loadStore();
    return store[telegramId.toString()] || null;
  }

  /**
   * Creates a new onchainos TEE wallet for a Telegram user and persists it.
   * Idempotent — returns existing wallet if already created.
   */
  static async createForUser(telegramId: number): Promise<UserWallet> {
    const existing = UserWalletStore.get(telegramId);
    if (existing) return existing;

    const onchainosPath =
      process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;

    console.log(`[UserWalletStore] Creating new TEE wallet for Telegram user ${telegramId}...`);
    const { stdout } = await execAsync(`${onchainosPath} wallet add`);

    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse onchainos wallet add output: ${stdout}`);
    }

    if (!parsed.ok || !parsed.data?.accountId) {
      throw new Error(`onchainos wallet add failed: ${JSON.stringify(parsed)}`);
    }

    // Extract the EVM address (same across all EVM chains)
    const addressList: { address: string; chainIndex: string }[] =
      parsed.data.addressList || [];
    const evmEntry = addressList.find((a) => a.chainIndex === "1") || addressList[0];

    if (!evmEntry) {
      throw new Error("No EVM address found in wallet add response");
    }

    const wallet: UserWallet = {
      accountId: parsed.data.accountId,
      address: evmEntry.address,
      createdAt: new Date().toISOString(),
    };

    const store = loadStore();
    store[telegramId.toString()] = wallet;
    saveStore(store);

    console.log(
      `[UserWalletStore] Created wallet for user ${telegramId}: ${wallet.address} (accountId: ${wallet.accountId})`
    );
    return wallet;
  }

  /**
   * Updates the dust threshold preference for a user (persisted to disk).
   * @param thresholdUsd - Any value between 0.5 and 500 USD
   */
  static setDustThreshold(telegramId: number, thresholdUsd: number): UserWallet {
    const store = loadStore();
    const wallet = store[telegramId.toString()];
    if (!wallet) throw new Error("No wallet found for user");
    wallet.dustThresholdUsd = thresholdUsd;
    saveStore(store);
    console.log(`[UserWalletStore] Dust threshold updated for user ${telegramId}: $${thresholdUsd}`);
    return wallet;
  }

  /**
   * Returns the effective dust threshold for a user (falls back to system default).
   */
  static getDustThreshold(telegramId: number): number {
    const wallet = UserWalletStore.get(telegramId);
    return wallet?.dustThresholdUsd ?? DEFAULT_DUST_THRESHOLD_USD;
  }
}
