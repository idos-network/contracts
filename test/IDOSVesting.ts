import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

const accounts = await ethers.getSigners();
const [owner, alice] = accounts;

const decimals = 18;
const totalSupply = ethers.parseUnits(BigInt(1e9).toString(), decimals);

describe("IDOSVesting", function () {
  it("Should work without cliff", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    const now = await networkHelpers.time.latest();
    const start = now + networkHelpers.time.duration.days(10);
    const vestingDuration = networkHelpers.time.duration.days(100);
    const cliffDuration = networkHelpers.time.duration.days(0);

    const idosVesting = await ethers.deployContract("IDOSVesting", [alice, start, vestingDuration, cliffDuration]);

    await idosToken.transfer(idosVesting, 100);

    const idosTokenAddress = ethers.Typed.address(await idosToken.getAddress());
    const releasableAfter = async (days) => {
      if (days > 0) await networkHelpers.time.increaseTo(now + networkHelpers.time.duration.days(days));
      return await idosVesting.releasable(idosTokenAddress);
    };

    // before start
    expect(await releasableAfter(0)).to.equal(0);
    expect(await releasableAfter(9)).to.equal(0);
    expect(await releasableAfter(10)).to.equal(0);

    // after cliff
    expect(await releasableAfter(11)).to.equal(1);
    expect(await releasableAfter(19)).to.equal(9);
    expect(await releasableAfter(20)).to.equal(10);
    expect(await releasableAfter(100)).to.equal(90);
    expect(await releasableAfter(110)).to.equal(100);

    // after end
    expect(await releasableAfter(111)).to.equal(100);
    expect(await releasableAfter(1000)).to.equal(100);
  });

  it("Should work with cliff", async function () {
    const idosToken = await ethers.deployContract("IDOSToken", [owner, owner]);

    const now = await networkHelpers.time.latest();
    const start = now + networkHelpers.time.duration.days(10);
    const vestingDuration = networkHelpers.time.duration.days(100);
    const cliffDuration = networkHelpers.time.duration.days(10);

    const idosVesting = await ethers.deployContract("IDOSVesting", [alice, start, vestingDuration, cliffDuration]);

    await idosToken.transfer(idosVesting, 100);

    const idosTokenAddress = ethers.Typed.address(await idosToken.getAddress());
    const releasableAfter = async (days) => {
      if (days > 0) await networkHelpers.time.increaseTo(now + networkHelpers.time.duration.days(days));
      return await idosVesting.releasable(idosTokenAddress);
    };

    // before start
    expect(await releasableAfter(0)).to.equal(0);
    expect(await releasableAfter(1)).to.equal(0);
    expect(await releasableAfter(9)).to.equal(0);
    expect(await releasableAfter(10)).to.equal(0);

    // before cliff
    expect(await releasableAfter(11)).to.equal(0);
    expect(await releasableAfter(19)).to.equal(0);

    // after cliff
    expect(await releasableAfter(20)).to.equal(10);
    expect(await releasableAfter(100)).to.equal(90);
    expect(await releasableAfter(110)).to.equal(100);

    // after end
    expect(await releasableAfter(111)).to.equal(100);
    expect(await releasableAfter(1000)).to.equal(100);
  });
});
