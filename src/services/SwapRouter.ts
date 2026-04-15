import { okxApi } from "./OkxApiClient";
import { TokenAsset } from "./WalletScanner";
import { networkConfig } from "../config/network";

/**
 * Represents the swap route data returned by OKX DEX Aggregator.
 */
export interface SwapRoute {
  inputToken: TokenAsset;
  outputToken: string;            // e.g., USDT contract address
  estimatedOutput: string;        // Expected output amount
  estimatedOutputUsd: string;     // Expected output in USD
  txData: {                       // Ready-to-sign transaction data
    from: string;
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  };
  approveData?: {                 // Token approval tx (if needed)
    to: string;
    data: string;
  };
}

// USDT address — automatically selected based on NETWORK env var
const USDT_ADDRESS = networkConfig.usdtAddress;

/**
 * Routes dust token swaps via OKX DEX Aggregator API.
 *
 * Onchain OS Skill: okx-dex-swap
 * This replaces the raw Uniswap SOR — the OKX aggregator routes through
 * Uniswap + 500 other DEX sources on X Layer for better fill rates.
 */
export class SwapRouter {
  private static readonly XLAYER_CHAIN_ID = "196";

  /**
   * Get the optimal swap route for a single dust token → USDT.
   */
  static async getSwapRoute(
    dustToken: TokenAsset,
    userAddress: string,
    outputToken: string = USDT_ADDRESS,
    amountRaw?: string
  ): Promise<SwapRoute> {
    const isMock = process.env.MOCK_MODE === "true";

    if (isMock) {
      return SwapRouter.getMockSwapRoute(dustToken, userAddress, outputToken, amountRaw);
    }

    return SwapRouter.getLiveSwapRoute(dustToken, userAddress, outputToken, amountRaw);
  }

  /**
   * Get swap routes for multiple dust tokens concurrently.
   * When routeViaContract=true, routes are generated for the DustSweeper contract
   * as the initiator (msg.sender) so the contract can execute the swaps atomically.
   */
  static async getSwapRoutes(
    dustTokens: { token: TokenAsset; amountRaw?: string }[],
    userAddress: string,
    outputToken: string = USDT_ADDRESS,
    routeViaContract: boolean = false
  ): Promise<{ routes: SwapRoute[]; failures: { symbol: string; error: string }[] }> {
    console.log(`[SwapRouter] Computing ${dustTokens.length} swap routes in parallel...`);

    const routes: SwapRoute[] = [];
    const failures: { symbol: string; error: string }[] = [];

    // When routing via contract, the contract is msg.sender on the DEX — use its address
    const { networkConfig } = await import("../config/network");
    const effectiveAddress = routeViaContract
      ? networkConfig.dustSweeperContract
      : userAddress;

    await Promise.all(
      dustTokens.map(async ({ token, amountRaw }) => {
        try {
          const route = await SwapRouter.getSwapRoute(token, effectiveAddress, outputToken, amountRaw);
          routes.push(route);
        } catch (err: any) {
          console.error(`[SwapRouter] Failed to route ${token.symbol}:`, err.message);
          failures.push({ symbol: token.symbol, error: err.message });
        }
      })
    );

    return { routes, failures };
  }

  /**
   * Live mode: Call OKX DEX Aggregator Swap API.
   */
  private static async getLiveSwapRoute(
    dustToken: TokenAsset,
    userAddress: string,
    outputToken: string,
    amountRaw?: string
  ): Promise<SwapRoute> {
    console.log(`[SwapRouter] Routing ${dustToken.symbol} → USDT via OKX DEX Aggregator...`);

    const swapAmount = amountRaw || dustToken.rawBalance;

    // Step 1: Get the swap quote + tx data (OKX DEX API V6)
    const swapResponse = await okxApi.get("/api/v6/dex/aggregator/swap", {
      chainIndex: networkConfig.chainId.toString(),
      fromTokenAddress: dustToken.tokenAddress,
      toTokenAddress: outputToken,
      amount: swapAmount,
      slippagePercent: "3.0",     // 3% slippage — crucial for tiny dust swaps to bypass safety rejections
      userWalletAddress: userAddress,
    });

    if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
      console.error(`[SwapRouter] OKX Swap API Failure Info:`, JSON.stringify(swapResponse, null, 2));
      throw new Error(`OKX DEX API error: ${swapResponse.msg || "Unknown error"}`);
    }

    const routeData = swapResponse.data[0];

    // Step 2: Check if approval is needed
    let approveData: SwapRoute["approveData"] | undefined;

    const approveResponse = await okxApi.get("/api/v6/dex/aggregator/approve-transaction", {
      chainIndex: networkConfig.chainId.toString(),
      tokenContractAddress: dustToken.tokenAddress,
      approveAmount: swapAmount,
    });

    if (approveResponse.code === "0" && approveResponse.data?.[0]) {
      approveData = {
        // approve() must be called ON the token contract, not the DEX router.
        // dexContractAddress is the spender encoded inside the calldata.
        to: dustToken.tokenAddress,
        data: approveResponse.data[0].data,
      };
    }

    return {
      inputToken: dustToken,
      outputToken,
      estimatedOutput: routeData.routerResult?.toTokenAmount || "0",
      // V6 returns toTokenAmount in raw units (USDT = 6 decimals) — convert to human-readable USD
      estimatedOutputUsd: (parseFloat(routeData.routerResult?.toTokenAmount || "0") / 1e6).toFixed(4),
      txData: {
        from: routeData.tx.from,
        to: routeData.tx.to,
        data: routeData.tx.data,
        value: routeData.tx.value || "0",
        gasLimit: routeData.tx.gas || "300000",
      },
      approveData,
    };
  }

  /**
   * Mock mode: Return deterministic test swap data.
   */
  private static async getMockSwapRoute(
    dustToken: TokenAsset,
    userAddress: string,
    outputToken: string,
    amountRaw?: string
  ): Promise<SwapRoute> {
    const swapAmount = amountRaw || dustToken.rawBalance;
    const isPartial = !!amountRaw;
    
    console.log(`[SwapRouter] MOCK — Routing ${dustToken.symbol} (${isPartial ? "PARTIAL" : "FULL"}) → USDT`);

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Simulate a 2% swap fee
    const tokenPower = Math.pow(10, dustToken.decimals);
    const usdValue = (parseFloat(swapAmount) / tokenPower) * parseFloat(dustToken.tokenPrice);
    const outputAmount = (usdValue * 0.98 * Math.pow(10, 6)).toFixed(0);

    return {
      inputToken: dustToken,
      outputToken,
      estimatedOutput: outputAmount,
      estimatedOutputUsd: (usdValue * 0.98).toFixed(2),
      txData: {
        from: userAddress,
        to: "0xDEXRouterMockAddress",
        data: "0x38ed1739" + "deadbeef".repeat(8),  // mock swap calldata
        value: "0",
        gasLimit: "250000",
      },
      approveData: {
        to: dustToken.tokenAddress,
        data: "0x095ea7b3" + "00".repeat(32),       // mock approve calldata
      },
    };
  }
}
