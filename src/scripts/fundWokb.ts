import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.XLAYER_MAINNET_RPC_URL);
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const agentWallet = process.env.AGENT_WALLET_ADDRESS!;

  console.log("Deployer:", deployer.address);
  const bal = await provider.getBalance(deployer.address);
  console.log("Deployer OKB:", ethers.formatEther(bal));

  const wokbAddress = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
  const wokbAbi = [
    "function deposit() public payable",
    "function transfer(address to, uint256 value) public returns (bool)"
  ];
  const wokb = new ethers.Contract(wokbAddress, wokbAbi, deployer);

  // Wrap 0.0008 OKB → WOKB (~$0.069) — enough to be dust, not enough alone for $0.10 paywall
  const amount = ethers.parseEther("0.0008");
  console.log("\nWrapping 0.0008 OKB → WOKB...");
  const tx1 = await wokb.deposit({ value: amount });
  await tx1.wait();
  console.log("✅ Wrapped");

  console.log(`Transferring WOKB to agent wallet ${agentWallet}...`);
  const tx2 = await wokb.transfer(agentWallet, amount);
  await tx2.wait();
  console.log("✅ WOKB sent to agent wallet");

  const balAfter = await provider.getBalance(deployer.address);
  console.log("Deployer OKB after:", ethers.formatEther(balAfter));
}

main().catch(console.error);
