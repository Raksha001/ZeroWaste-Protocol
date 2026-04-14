import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function checkAgent() {
  const provider = new ethers.JsonRpcProvider(process.env.XLAYER_TESTNET_RPC_URL);
  const agentAddress = process.env.AGENT_WALLET_ADDRESS!;
  const bal = await provider.getBalance(agentAddress);
  console.log(`Agentic Wallet (${agentAddress}) OKB Balance:`, ethers.formatEther(bal));
}
checkAgent();
