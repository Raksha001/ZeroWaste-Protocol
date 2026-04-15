/**
 * UserWalletStore.ts
 *
 * Manages per-user agent wallets. Persisted to .data/user-wallets.json.
 *
 * Wallet creation modes (automatic):
 *  - If onchainos CLI is present → create TEE wallet via onchainos (local dev)
 *  - If onchainos not found → generate ethers.js wallet (cloud/Railway)
 */
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

const execAsync = promisify(exec);

export const DEFAULT_DUST_THRESHOLD_USD = 50.0;

export interface UserWallet {
  accountId: string;           // onchainos account UUID -OR- wallet address (ethers mode)
  address: string;             // EVM address
  privateKey?: string;         // Present in ethers.js mode; absent in onchainos mode
  createdAt: string;
  dustThresholdUsd?: number;   // per-user preference, defaults to DEFAULT_DUST_THRESHOLD_USD
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

function onchainsosPath(): string {
  return process.env.ONCHAINOS_PATH || `${process.env.HOME}/.local/bin/onchainos`;
}

function isOnchainsAvailable(): boolean {
  return fs.existsSync(onchainsosPath());
}

export class UserWalletStore {
  /**
   * Returns the wallet for a Telegram user, or null if not set up yet.
   */
  static get(telegramId: number): UserWallet | null {
    const store = loadStore();
    return store[telegramId.toString()] || null;
  }

  /**
   * Creates a new agent wallet for a Telegram user and persists it.
   * Idempotent — returns existing wallet if already created.
   *
   * Mode detection (automatic):
   *  - onchainos CLI present → TEE wallet via onchainos wallet add
   *  - onchainos not found   → ethers.Wallet.createRandom() (cloud-safe)
   */
  static async createForUser(telegramId: number): Promise<UserWallet> {
    const existing = UserWalletStore.get(telegramId);
    if (existing) return existing;

    // ── Ethers.js mode (Railway / cloud — no onchainos) ────────────────────
    if (!isOnchainsAvailable()) {
      console.log(`[UserWalletStore] onchainos not found — creating ethers.js wallet for user ${telegramId}`);
      const newWallet = ethers.Wallet.createRandom();

      const wallet: UserWallet = {
        accountId: newWallet.address,  // use address as the ID in ethers mode
        address: newWallet.address,
        privateKey: newWallet.privateKey,
        createdAt: new Date().toISOString(),
      };

      const store = loadStore();
      store[telegramId.toString()] = wallet;
      saveStore(store);
      console.log(`[UserWalletStore] Ethers wallet created for user ${telegramId}: ${wallet.address}`);
      return wallet;
    }

    // ── onchainos CLI mode (local dev — TEE wallet) ────────────────────────
    console.log(`[UserWalletStore] Creating new TEE wallet via onchainos for user ${telegramId}...`);
    const { stdout } = await execAsync(`${onchainsosPath()} wallet add`);

    let parsed: any;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse onchainos wallet add output: ${stdout}`);
    }

    if (!parsed.ok || !parsed.data?.accountId) {
      throw new Error(`onchainos wallet add failed: ${JSON.stringify(parsed)}`);
    }

    const addressList: { address: string; chainIndex: string }[] =
      parsed.data.addressList || [];
    const evmEntry = addressList.find((a) => a.chainIndex === "1") || addressList[0];

    if (!evmEntry) {
      throw new Error("No EVM address found in wallet add response");
    }

    const wallet: UserWallet = {
      accountId: parsed.data.accountId,
      address: evmEntry.address,
      // No privateKey — managed by onchainos TEE
      createdAt: new Date().toISOString(),
    };

    const store = loadStore();
    store[telegramId.toString()] = wallet;
    saveStore(store);

    console.log(
      `[UserWalletStore] TEE wallet created for user ${telegramId}: ${wallet.address} (accountId: ${wallet.accountId})`
    );
    return wallet;
  }

  /**
   * Updates the dust threshold preference for a user (persisted to disk).
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
