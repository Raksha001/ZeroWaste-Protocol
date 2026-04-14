import { ethers } from "hardhat";

async function main() {
  console.log("Deploying DustSweeperMulticall to X Layer...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "OKB\n");

  const DustSweeper = await ethers.getContractFactory("DustSweeperMulticall");
  const dustSweeper = await DustSweeper.deploy();

  await dustSweeper.waitForDeployment();

  const address = await dustSweeper.getAddress();
  console.log("✅ DustSweeperMulticall deployed to:", address);
  console.log("\nAdd this to your .env:");
  console.log(`DUST_SWEEPER_CONTRACT=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
