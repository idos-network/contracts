import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

const accounts = await ethers.getSigners();
const [owner, alice] = accounts;

const decimals = 18;
const totalSupply = ethers.parseUnits(BigInt(1e9).toString(), decimals);

describe("IDOSToken", function () {
  it("Should premint 1B tokens", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    expect(await idosToken.totalSupply()).to.equal(totalSupply);
  });

  it("Should not allow minting", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    expect(idosToken.mint).to.equal(undefined);
    expect(idosToken._mint).to.equal(undefined);
  });

  it("Should allow burning", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    expect(await idosToken.balanceOf(alice)).to.equal(0);

    await idosToken.transfer(alice, 1);

    expect(await idosToken.balanceOf(alice)).to.equal(1);

    await idosToken.connect(alice).burn(1);

    expect(await idosToken.balanceOf(alice)).to.equal(0);
    expect(await idosToken.totalSupply()).to.equal(totalSupply - 1n);
  });

  it("Should allow pausing and unpausing by owner", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    await expect(idosToken.connect(alice).pause()).to.be.revertedWithCustomError(idosToken, "OwnableUnauthorizedAccount");

    await idosToken.pause();

    await expect(idosToken.transfer(alice, 1)).to.be.revertedWithCustomError(idosToken, "EnforcedPause");
    expect(await idosToken.balanceOf(alice)).to.equal(0);

    await idosToken.unpause();

    await expect(idosToken.transfer(alice, 1)).to.not.be.revertedWithCustomError(idosToken, "EnforcedPause");
    expect(await idosToken.balanceOf(alice)).to.equal(1);
  });
});
