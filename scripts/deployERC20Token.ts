import { deployments } from "hardhat";

async function main() {
  await deployments.fixture(["ERC20"]);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
