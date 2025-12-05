import { expect } from "chai";
import { network } from "hardhat";
import type { IDOSToken } from "../types/ethers-contracts/index.js";

const { ethers } = await network.connect();

const accounts = await ethers.getSigners();
const [owner, alice] = accounts;

const decimals = 18;
const totalSupply = ethers.parseUnits(BigInt(1e9).toString(), decimals);

describe("IDOSToken", () => {
	let idosToken: IDOSToken;

	beforeEach(async () => {
		idosToken = await ethers.deployContract("IDOSToken", [owner]) as unknown as IDOSToken;
	});

	it("Should premint 1B tokens", async () => {
		expect(await idosToken.totalSupply()).to.equal(totalSupply);
	});

	it("Should not allow minting", async () => {
		// @ts-expect-error
		expect(idosToken.mint).to.equal(undefined);
		// @ts-expect-error
		expect(idosToken._mint).to.equal(undefined);
	});

	it("Should allow burning", async () => {
		expect(await idosToken.balanceOf(alice)).to.equal(0);

		await idosToken.transfer(alice, 1);

		expect(await idosToken.balanceOf(alice)).to.equal(1);

		await idosToken.connect(alice).burn(1);

		expect(await idosToken.balanceOf(alice)).to.equal(0);
		expect(await idosToken.totalSupply()).to.equal(totalSupply - 1n);
	});
});
