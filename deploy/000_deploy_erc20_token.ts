import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployERC20: DeployFunction = async function (
    hre: HardhatRuntimeEnvironment
) {
    const { getNamedAccounts, network, run, ethers } = hre;
    const isLocalChain = network.name === "hardhat" || network.name === "localhost"
    const { deploy, log } = hre.deployments;
    const { deployer } = await getNamedAccounts();
    const initialSupply = ethers.utils.parseEther("1000000");

    const args = [initialSupply];
    const Rowdy = await deploy("RowdyToken", {
        from: deployer,
        log: true,
        args,
        waitConfirmations: isLocalChain ? 0 : 6,
    });
    log("You have deployed the RowdyToken contract to:", Rowdy.address);
    if (!isLocalChain) {
        log("Verifying contract...");
        // Wait for etherscan to notice that the contract has been deployed
        await new Promise((resolve) => setTimeout(resolve, 20000));

        await run("verify:verify", {
            address: Rowdy.address,
            constructorArguments: [initialSupply],
            contract: "contracts/RowdyToken.sol:RowdyToken",
        });
        log("Verified contract on etherscan.io");
    }
};
export default deployERC20;
deployERC20.tags = ["ERC20"];
