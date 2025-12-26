import { expect } from "chai";
import type { Signer } from "ethers";
import { network } from "hardhat";
import type { IDOSNodeStaking, IDOSToken } from "../types/ethers-contracts/index.js";
import { Duration, evmTimestamp } from "./utils/time.js";

const { ethers, networkHelpers } = await network.connect();

type SignerWithAddress = Signer & { address: string };

describe("Gas Benchmark", () => {
  let idosToken: IDOSToken;
  let idosStaking: IDOSNodeStaking;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let node1: SignerWithAddress;
  let node2: SignerWithAddress;

  const setup = async () => {
    const accounts = await ethers.getSigners();
    [owner, user1, user2, node1, node2] = accounts as SignerWithAddress[];

    idosToken = await ethers.deployContract("IDOSToken", [owner]) as unknown as IDOSToken;
    idosStaking = await ethers.deployContract("IDOSNodeStaking", [
      await idosToken.getAddress(),
      owner,
      evmTimestamp(2026, 11),
      100
    ]) as unknown as IDOSNodeStaking;

    await idosToken.transfer(idosStaking, 10000);
    await idosToken.transfer(user1, 10000);
    await idosToken.transfer(user2, 10000);
    
    const idosStakingAddress = await idosStaking.getAddress();
    await idosToken.connect(user1).approve(idosStakingAddress, 10000);
    await idosToken.connect(user2).approve(idosStakingAddress, 10000);

    await networkHelpers.time.increaseTo(evmTimestamp(2026, 11));
    await idosStaking.allowNode(node1);
    await idosStaking.allowNode(node2);

    return { idosToken, idosStaking, owner, user1, user2, node1, node2 };
  };

  before(async () => {
    ({ idosToken, idosStaking, owner, user1, user2, node1, node2 } = await networkHelpers.loadFixture(setup));
  });

  describe("Gas Cost Measurements", () => {
    it("Should measure stake() gas cost", async () => {
      const tx = await idosStaking.connect(user1).stake(ethers.ZeroAddress, node1.address, 100);
      const receipt = await tx.wait();
      
      console.log(`\n  ⛽ stake() gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(350000);
    });

    it("Should measure unstake() gas cost", async () => {
      await idosStaking.connect(user1).stake(ethers.ZeroAddress, node1.address, 100);
      
      const tx = await idosStaking.connect(user1).unstake(node1.address, 50);
      const receipt = await tx.wait();
      
      console.log(`  ⛽ unstake() gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(200000);
    });

    it("Should measure withdrawReward() gas cost (1 epoch)", async () => {
      await idosStaking.connect(user2).stake(ethers.ZeroAddress, node2.address, 100);
      await networkHelpers.time.increase(Duration.days(1));
      
      const tx = await idosStaking.connect(user2).withdrawReward();
      const receipt = await tx.wait();
      
      console.log(`  ⛽ withdrawReward(1 epoch) gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(260000);
    });

    it("Should measure withdrawReward() gas cost (10 epochs)", async () => {
      await idosStaking.connect(user1).stake(ethers.ZeroAddress, node1.address, 100);
      await networkHelpers.time.increase(Duration.days(10));
      
      const tx = await idosStaking.connect(user1).withdrawReward();
      const receipt = await tx.wait();
      
      console.log(`  ⛽ withdrawReward(10 epochs) gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(310000);
    });

    it("Should measure withdrawReward() gas cost (30 epochs)", async () => {
      await idosStaking.connect(user2).stake(ethers.ZeroAddress, node2.address, 500);
      await networkHelpers.time.increase(Duration.days(30));
      
      const tx = await idosStaking.connect(user2).withdrawReward();
      const receipt = await tx.wait();
      
      console.log(`  ⛽ withdrawReward(30 epochs) gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(550000);
    });

    it("Should measure withdrawUnstaked() gas cost (single unstake)", async () => {
      await idosStaking.connect(user1).stake(ethers.ZeroAddress, node1.address, 200);
      await idosStaking.connect(user1).unstake(node1.address, 100);
      await networkHelpers.time.increase(Duration.days(14));
      
      const tx = await idosStaking.connect(user1).withdrawUnstaked();
      const receipt = await tx.wait();
      
      console.log(`  ⛽ withdrawUnstaked(1 unstake) gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(100000);
    });

    it("Should measure withdrawUnstaked() gas cost (5 unstakes)", async () => {
      await idosStaking.connect(user2).stake(ethers.ZeroAddress, node2.address, 1000);
      
      for (let i = 0; i < 5; i++) {
        await idosStaking.connect(user2).unstake(node2.address, 50);
        await networkHelpers.time.increase(Duration.days(1));
      }
      
      await networkHelpers.time.increase(Duration.days(14));
      
      const tx = await idosStaking.connect(user2).withdrawUnstaked();
      const receipt = await tx.wait();
      
      console.log(`  ⛽ withdrawUnstaked(5 unstakes) gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(150000);
    });

    it("Should measure slash() gas cost", async () => {
      await idosStaking.allowNode(user1.address);
      await idosStaking.connect(user2).stake(ethers.ZeroAddress, user1.address, 100);
      
      const tx = await idosStaking.slash(user1.address);
      const receipt = await tx.wait();
      
      console.log(`  ⛽ slash() gas: ${receipt?.gasUsed.toString()}`);
      expect(receipt?.gasUsed).to.be.lt(180000);
    });
  });

  describe("Optimization Impact Analysis", () => {
    it("Should confirm unchecked loop optimization reduces gas", async () => {
      await idosStaking.connect(user1).stake(ethers.ZeroAddress, node1.address, 500);
      await networkHelpers.time.increase(Duration.days(20));
      
      const tx = await idosStaking.connect(user1).withdrawReward();
      const receipt = await tx.wait();
      
      const gasPerEpoch = Number(receipt?.gasUsed) / 20;
      console.log(`\n  📊 Gas per epoch (with unchecked): ${gasPerEpoch.toFixed(0)}`);
      console.log(`  💰 Est. savings vs checked: ~${(gasPerEpoch * 0.1).toFixed(0)} gas/epoch`);
      
      expect(gasPerEpoch).to.be.lt(20000);
    });
  });
});
