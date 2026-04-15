import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "00".repeat(32);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    xlayer: {
      url: "https://okx-xlayer.rpc.blxrbdn.com",
      chainId: 196,
      accounts: [PRIVATE_KEY],
    },
    xlayerTestnet: {
      url: "https://testrpc.xlayer.tech",
      chainId: 1952,
      accounts: [PRIVATE_KEY],
    },
  },
};

export default config;
