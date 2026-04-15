import { ethers } from "ethers";
dotenv.config();
import dotenv from "dotenv";

async function main() {
  const provider = new ethers.JsonRpcProvider("https://okx-xlayer.rpc.blxrbdn.com");
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock("latest");
  console.log("Gas Price:    ", ethers.formatUnits(feeData.gasPrice || 0n, "gwei"), "gwei");
  console.log("Max Fee:      ", ethers.formatUnits(feeData.maxFeePerGas || 0n, "gwei"), "gwei");
  console.log("Block Gas Limit:", block?.gasLimit?.toString());
  
  // Cost of a typical ERC20 transfer (~65,000 gas) and swap (~200,000 gas)
  const gasPrice = feeData.gasPrice || 0n;
  const transferCost = gasPrice * 65000n;
  const swapCost = gasPrice * 200000n;
  console.log("\nEstimated costs:");
  console.log("  ERC20 transfer: ", ethers.formatEther(transferCost), "OKB  ($" + (parseFloat(ethers.formatEther(transferCost)) * 87.03).toFixed(6) + ")");
  console.log("  DEX swap:       ", ethers.formatEther(swapCost), "OKB  ($" + (parseFloat(ethers.formatEther(swapCost)) * 87.03).toFixed(6) + ")");
  
  // Full flow: 2 approves + 2 swaps + 1 transfer = 5 txns
  const fullFlowCost = (transferCost * 3n) + (swapCost * 2n);
  console.log("  Full flow (5 txns):", ethers.formatEther(fullFlowCost), "OKB  ($" + (parseFloat(ethers.formatEther(fullFlowCost)) * 87.03).toFixed(6) + ")");
}
main().catch(console.error);
