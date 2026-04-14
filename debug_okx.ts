import { okxApi } from "./src/services/OkxApiClient.ts";
async function debug() {
  const response = await okxApi.get("/api/v5/wallet/asset/all-token-balances-by-address", { address: "0x1d56610a07f5f947ab2d6eb299495be03a1f8bb0", chains: "196" });
  console.log(JSON.stringify(response.data, null, 2));
}
debug()
