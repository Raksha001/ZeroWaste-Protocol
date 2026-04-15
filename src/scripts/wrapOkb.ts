import { exec } from "child_process";
import { promisify } from "util";
import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// Wrap 0.002 OKB → WOKB directly from the agent wallet via onchainos TEE
// deposit() selector: 0xd0e30db0 (WOKB.deposit() is payable, no calldata args needed)

const execAsync = promisify(exec);

const RPC       = "https://okx-xlayer.rpc.blxrbdn.com";
const WOKB_ADDR = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
const AGENT     = "0x1d56610a07f5f947ab2d6eb299495be03a1f8bb0";
const WRAP_AMT  = "2000000000000000"; // 0.002 OKB in wei

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const okb = await provider.getBalance(AGENT);
  console.log(`Agent OKB: ${ethers.formatEther(okb)} (${(parseFloat(ethers.formatEther(okb)) * 86.49).toFixed(3)} USD)`);

  const onchainosPath = `${process.env.HOME}/.local/bin/onchainos`;
  const depositSelector = "0xd0e30db0"; // deposit()

  console.log(`\nWrapping 0.002 OKB → WOKB via onchainos...`);
  const cmd = `${onchainosPath} wallet contract-call --to ${WOKB_ADDR} --chain 196 --input-data ${depositSelector} --amt ${WRAP_AMT} --force`;
  console.log(`> ${cmd}\n`);

  const { stdout, stderr } = await execAsync(cmd);
  console.log("stdout:", stdout);
  if (stderr) console.log("stderr:", stderr);

  const txHash = stdout.match(/0x[a-fA-F0-9]{64}/)?.[0];
  if (txHash) {
    console.log(`✅ Wrap tx: ${txHash}`);
  }

  // Check new WOKB balance
  const wokbAbi = ["function balanceOf(address) view returns (uint256)"];
  const wokb = new ethers.Contract(WOKB_ADDR, wokbAbi, provider);
  await new Promise(r => setTimeout(r, 4000)); // wait for indexing
  const bal = await wokb.balanceOf(AGENT);
  console.log(`\nAgent WOKB balance: ${ethers.formatEther(bal)} WOKB (~$${(parseFloat(ethers.formatEther(bal)) * 86.49).toFixed(3)})`);
}

main().catch(console.error);
