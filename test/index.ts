import { expect } from "chai";
import { deployments, ethers } from "hardhat";

describe("RowdyToken", function () {
  it("Should deploy rowdy token", async function () {
    await deployments.fixture(["ERC20"]);
    const rowdyContract = await ethers.getContract("RowdyToken");
    expect(rowdyContract.address).to.be.string;
  });
});
