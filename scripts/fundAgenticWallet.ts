import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
    console.log("🚀 Preparing the Agentic Wallet with Gas and Dust on X Layer Mainnet...");

    const deployer = (await ethers.getSigners())[0];
    const agentWallet = process.env.AGENT_WALLET_ADDRESS;
    if (!agentWallet) throw new Error("No AGENT_WALLET_ADDRESS found in .env");

    const balanceBefore = await ethers.provider.getBalance(deployer.address);
    console.log(`\nDeployer OKB Balance: ${ethers.formatEther(balanceBefore)} OKB`);
    
    // WOKB (Wrapped OKB) contract on X Layer Mainnet
    const wokbAddress = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
    
    const wokbAbi = [
        "function deposit() public payable",
        "function transfer(address to, uint256 value) public returns (bool)"
    ];
    const wokb = new ethers.Contract(wokbAddress, wokbAbi, deployer);

    // 1. Wrap 0.008 OKB into WOKB (~$0.40 worth, which acts as our 'dust')
    const dustAmountToWrap = ethers.parseEther("0.008"); 
    console.log(`\n1. Wrapping ${ethers.formatEther(dustAmountToWrap)} OKB into WOKB dust...`);
    const tx1 = await wokb.deposit({ value: dustAmountToWrap });
    await tx1.wait();
    console.log("✅ Successfully wrapped OKB into WOKB");

    // 2. Transfer the WOKB dust to the Agentic Wallet
    console.log(`\n2. Sending WOKB dust to Agent: ${agentWallet}`);
    const tx2 = await wokb.transfer(agentWallet, dustAmountToWrap);
    await tx2.wait();
    console.log("✅ WOKB Dust successfully loaded into Agent's inventory!");

    // 3. Transfer 0.005 OKB for gas to the Agentic Wallet (~$0.25)
    // The Agent needs this gas to execute the swaps on DEX route
    const gasAmountToFund = ethers.parseEther("0.005");
    console.log(`\n3. Sending ${ethers.formatEther(gasAmountToFund)} native OKB gas to Agent...`);
    const tx3 = await deployer.sendTransaction({
        to: agentWallet,
        value: gasAmountToFund
    });
    await tx3.wait();
    console.log("✅ Gas successfully sent!");

    const balanceAfter = await ethers.provider.getBalance(deployer.address);
    console.log(`\n🎉 All done! Final Deployer OKB Balance: ${ethers.formatEther(balanceAfter)} OKB`);
    console.log("The Telegram bot is now fully fueled to pay the $0.10 x402 paywall!");
}

main().catch((err) => {
    console.error("❌ Script Error:", err);
    process.exitCode = 1;
});
