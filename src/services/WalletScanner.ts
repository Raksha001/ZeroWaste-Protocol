import { okxApi } from "./OkxApiClient";
import { ethers } from "ethers";
import { networkConfig } from "../config/network";

/**
 * Represents a token asset in the user's wallet.
 */
export interface TokenAsset {
  chainIndex: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  balance: string;            // Human-readable balance (e.g. "0.008")
  rawBalance: string;         // Balance in smallest unit / wei (required by DEX V6 API)
  tokenPrice: string;         // USD price per token
  tokenType: string;          // "1" = native, "20" = ERC20
  isRiskToken: boolean;
  usdValue: number;           // Computed: balance * price
}

/**
 * Scans a user's X Layer wallet for "dust" tokens via OKX Wallet Portfolio API.
 * 
 * Onchain OS Skill: okx-wallet-portfolio
 */
export class WalletScanner {
  // X Layer chain index in OKX system
  private static readonly XLAYER_CHAIN_INDEX = "196";
  // Dust threshold in USD
  private static readonly DEFAULT_DUST_THRESHOLD = 50.0;

  /**
   * Get all dust tokens (< $50 value) from the user's X Layer wallet.
   */
  static async getDustTokens(
    walletAddress: string,
    excludeToken?: string,
    dustThresholdUsd: number = WalletScanner.DEFAULT_DUST_THRESHOLD
  ): Promise<TokenAsset[]> {
    const isMock = process.env.MOCK_MODE === "true";

    if (isMock) {
      return WalletScanner.getMockDustTokens(walletAddress);
    }

    if (networkConfig.isTestnet) {
      return WalletScanner.getTestnetDustTokens(walletAddress, excludeToken, dustThresholdUsd);
    }

    return WalletScanner.getLiveDustTokens(walletAddress, excludeToken, dustThresholdUsd);
  }

  /**
   * Live Testnet mode: Ethers.js scanning since OKX Portfolio doesn't index testnets.
   */
  private static async getTestnetDustTokens(
    walletAddress: string,
    excludeToken?: string,
    dustThresholdUsd: number = WalletScanner.DEFAULT_DUST_THRESHOLD
  ): Promise<TokenAsset[]> {
    console.log(`[WalletScanner] Scanning Testnet dust via Ethers RPC for ${walletAddress}...`);
    
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    
    // The tokens the user reported having on X Layer testnet
    const tokens = [
      { symbol: "USDG", address: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1", decimals: 18 },
      { symbol: "USDC", address: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d", decimals: 18 }, // Assuming 18 based on typical testnet configs
      { symbol: "USDT0", address: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c", decimals: 18 }
    ];

    const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];
    const foundDust: TokenAsset[] = [];

    for (const token of tokens) {
      try {
        const contract = new ethers.Contract(token.address, erc20Abi, provider);
        const rawBalance = await contract.balanceOf(walletAddress);
        
        if (rawBalance > 0n) {
          // Assume $1.00 USD price for stablecoins
          const floatBalance = parseFloat(ethers.formatUnits(rawBalance, token.decimals));
          const usdValue = floatBalance * 1.0; 

          if (usdValue < dustThresholdUsd) {
            foundDust.push({
              chainIndex: networkConfig.chainId.toString(),
              tokenAddress: token.address,
              symbol: token.symbol,
              decimals: token.decimals,
              balance: floatBalance.toString(),
              rawBalance: rawBalance.toString(),
              tokenPrice: "1.00",
              tokenType: "20",
              isRiskToken: false,
              usdValue
            });
          }
        }
      } catch (err: any) {
        console.error(`[WalletScanner] Failed to fetch balance for ${token.symbol}: ${err.message}`);
      }
    }

    console.log(`[WalletScanner] Found ${foundDust.length} dust tokens on testnet.`);
    return foundDust;
  }

  /**
   * Live mode: Query OKX Wallet Portfolio API.
   */
  private static async getLiveDustTokens(
    walletAddress: string,
    excludeToken?: string,
    dustThresholdUsd: number = WalletScanner.DEFAULT_DUST_THRESHOLD
  ): Promise<TokenAsset[]> {
    console.log(`[WalletScanner] Scanning ${walletAddress} on X Layer via Onchain OS...`);

    try {
      const response = await okxApi.get(
        "/api/v5/wallet/asset/all-token-balances-by-address",
        {
          address: walletAddress,
          chains: WalletScanner.XLAYER_CHAIN_INDEX,
        }
      );

      if (!response.data || response.data.length === 0) {
        console.log("[WalletScanner] No tokens found.");
        return [];
      }

      console.log("[DEBUG] Raw OKX API Response:", JSON.stringify(response.data, null, 2));

      // Parse and filter dust tokens
      const allTokens: TokenAsset[] = [];

      for (const chainData of response.data) {
        if (!chainData.tokenAssets) continue;

        for (const token of chainData.tokenAssets) {
          const balance = parseFloat(token.balance || "0");
          const price = parseFloat(token.tokenPrice || "0");
          const usdValue = balance * price;

          // Skip pure native gas token (OKB) and zero-balance tokens
          if ((token.tokenType === "1" && (!token.tokenAddress || token.symbol === "OKB")) || balance === 0) continue;

          if (usdValue > 0 && usdValue < dustThresholdUsd) {
            allTokens.push({
              chainIndex: WalletScanner.XLAYER_CHAIN_INDEX,
              tokenAddress: token.tokenContractAddress || token.tokenAddress,
              symbol: token.symbol,
              decimals: parseInt(token.decimals || "18"),
              balance: token.balance,
              rawBalance: token.rawBalance,   // wei-unit string for DEX V6 API
              tokenPrice: token.tokenPrice,
              tokenType: token.tokenType,
              isRiskToken: token.isRiskToken || false,
              usdValue,
            });
          }
        }
      }

      // Sort by value descending (use highest-value dust first)
      allTokens.sort((a, b) => b.usdValue - a.usdValue);

      console.log(`[WalletScanner] Found ${allTokens.length} dust tokens worth $${allTokens.reduce((s, t) => s + t.usdValue, 0).toFixed(2)} total.`);
      return allTokens;
    } catch (error: any) {
      console.error("[WalletScanner] API error:", error.response?.data || error.message);
      throw new Error("Failed to scan wallet via Onchain OS");
    }
  }

  /**
   * Mock mode: Return deterministic test data for development.
   */
  private static async getMockDustTokens(_walletAddress: string): Promise<TokenAsset[]> {
    console.log(`[WalletScanner] MOCK MODE — Returning test dust tokens...`);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return [
      {
        chainIndex: "196",
        tokenAddress: "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035",
        symbol: "USDC.e",
        decimals: 6,
        balance: "2.5",
        rawBalance: "2500000",
        tokenPrice: "1.00",
        tokenType: "20",
        isRiskToken: false,
        usdValue: 2.5,
      },
      {
        chainIndex: "196",
        tokenAddress: "0x5A77f1443D16ee5761d310e38b7308067eA468B9",
        symbol: "WETH",
        decimals: 18,
        balance: "2.0",
        rawBalance: "2000000000000000000",
        tokenPrice: "2350.00",
        tokenType: "20",
        isRiskToken: false,
        usdValue: 4700.0,
      },
    ];
  }

  /**
   * Select the optimal basket of dust tokens to cover a target USD amount.
   * Adds a slippage buffer (default 5%) to account for swap slippage.
   */
  static selectDustBasket(
    dustTokens: TokenAsset[],
    targetAmountUsd: number,
    slippagePct: number = 0.05
  ): { selected: TokenAsset[]; totalValue: number; sufficient: boolean } {
    const requiredAmount = targetAmountUsd * (1 + slippagePct);
    let accumulated = 0;
    const selected: TokenAsset[] = [];

    for (const token of dustTokens) {
      if (accumulated >= requiredAmount) break;
      selected.push(token);
      accumulated += token.usdValue;
    }

    return {
      selected,
      totalValue: accumulated,
      sufficient: accumulated >= targetAmountUsd,
    };
  }
}
