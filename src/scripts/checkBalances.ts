import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const RPC = "https://okx-xlayer.rpc.blxrbdn.com";
const OLD_AGENT  = "0x1d56610a07f5f947ab2d6eb299495be03a1f8bb0";
const NEW_AGENT  = "0xc5da9414c0f76ce72e1b2474ae92716325460cd6";
const DEPLOYER   = "0x2fBa2c09bD34Cc638faf30e98D88f354aC47A09F";
const OKB_PRICE  = 87.03;
const ETH_PRICE  = 2406.75;

const TOKENS = [
  { symbol: "USDT",   address: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d", decimals: 6  },
  { symbol: "USDC",   address: "0x74b7F16337b8972027F6196A17a631aC6dE26d22", decimals: 6  },
  { symbol: "USDC.e", address: "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035", decimals: 6  },
  { symbol: "WETH",   address: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c", decimals: 18 },
  { symbol: "WOKB",   address: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", decimals: 18 },
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function printWallet(label: string, address: string, provider: ethers.JsonRpcProvider) {
  console.log(`\n=== ${label} ===`);
  console.log(`    ${address}`);
  const okb = await provider.getBalance(address);
  const okbFloat = parseFloat(ethers.formatEther(okb));
  console.log(`  OKB: ${okbFloat.toFixed(8)}  (~$${(okbFloat * OKB_PRICE).toFixed(3)})`);
  for (const t of TOKENS) {
    const c = new ethers.Contract(t.address, ERC20_ABI, provider);
    const bal = await c.balanceOf(address);
    if (bal > 0n) {
      const human = parseFloat(ethers.formatUnits(bal, t.decimals));
      const usd = t.symbol === "WETH" ? human * ETH_PRICE
                : t.symbol === "WOKB" ? human * OKB_PRICE
                : human;
      console.log(`  ${t.symbol}: ${human}  (~$${usd.toFixed(3)})`);
    }
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  await printWallet("OLD Agent Wallet (inaccessible — no signing key)", OLD_AGENT, provider);
  await printWallet("NEW Agent Wallet (onchainos CLI — active)", NEW_AGENT, provider);
  await printWallet("Deployer Wallet (ethers.js — has private key)", DEPLOYER, provider);
}
main().catch(console.error);
