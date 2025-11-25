import { expect } from "chai";
import type { Signer } from "ethers";
import { network } from "hardhat";
import type { IDOSNodeStaking, IDOSToken, } from "../types/ethers-contracts/index.js";
import { Duration, evmTimestamp } from "./utils/time.js";

const { ethers, networkHelpers } = await network.connect();

const accounts = await ethers.getSigners();
const [owner, user1, user2, user3, node1, node2, node3] = accounts;

type SignerWithAddress = Signer & { address: string };

const ZERO_ADDR = ethers.ZeroAddress;
const ZERO_ACCT = { address: ZERO_ADDR } as SignerWithAddress;

describe("IDOSNodeStaking", () => {
  let idosToken: IDOSToken, idosStaking: IDOSNodeStaking;

  const allowNode = (node: SignerWithAddress) =>
    idosStaking.allowNode(node);

  const stake = (user: SignerWithAddress, node: SignerWithAddress, amount: number) =>
    idosStaking.connect(user).stake(ZERO_ADDR, node.address, amount);

  const unstake = (user: SignerWithAddress, node: SignerWithAddress, amount: number) =>
    idosStaking.connect(user).unstake(node.address, amount);

  const slash = (node: SignerWithAddress) =>
    idosStaking.slash(node);

  const stakeByNodeByUser = (user: SignerWithAddress, node: SignerWithAddress) =>
    idosStaking.stakeByNodeByUser(user.address, node.address);

  const getNodeStake = (node: SignerWithAddress) =>
    idosStaking.getNodeStake(node.address);

  const getUserStake = (user: SignerWithAddress) =>
    idosStaking.getUserStake(user.address);

  const withdrawableReward = async (user: SignerWithAddress) =>
    (await idosStaking.withdrawableReward(user.address)).withdrawableAmount;

  const setup = async () => {
    idosToken = await ethers.deployContract("IDOSToken", [owner, owner]) as unknown as IDOSToken;

    idosStaking = await ethers.deployContract("IDOSNodeStaking", [await idosToken.getAddress(), owner, evmTimestamp(2026, 11), 100]) as unknown as IDOSNodeStaking;

    await idosToken.transfer(idosStaking, 10000);

    const idosStakingAddress = await idosStaking.getAddress();
    for (const user of [user1, user2, user3]) {
      await idosToken.transfer(user, 1000);
      await idosToken.connect(user).approve(idosStakingAddress, 1000);
    }
    return { idosToken, idosStaking };
  };

  beforeEach(async () => {
    ({ idosToken, idosStaking } = await networkHelpers.loadFixture(setup));
  });

  describe("Pausing", () => {
    describe("When not paused", () => {
      it("Can be paused only by owner", async () => {
        await expect(idosStaking.pause())
          .to.not.revert(ethers);

        await expect(idosStaking.connect(user1).pause())
          .to.be.revertedWithCustomError(idosStaking, "OwnableUnauthorizedAccount");
      });
    });

    describe("When paused", () => {
      beforeEach(async () => {
        await idosStaking.pause();
      });

      it("Can be unpaused by owner", async () => {
        await expect(idosStaking.unpause()).to.not.revert(ethers);
      });

      it("Can't allowNode", async () => {
        await expect(idosStaking.allowNode(node1))
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't disallowNode", async () => {
        await expect(idosStaking.disallowNode(node1))
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't stake", async () => {
        await expect(stake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't unstake", async () => {
        await expect(unstake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't withdrawUnstaked", async () => {
        await expect(idosStaking.connect(user1).withdrawUnstaked())
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't withdrawSlashedStakes", async () => {
        await expect(idosStaking.withdrawSlashedStakes())
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });

      it("Can't withdrawReward", async () => {
        await expect(idosStaking.connect(user1).withdrawReward())
          .to.be.revertedWithCustomError(idosStaking, "EnforcedPause");
      });
    });
  });

  describe("Allowlisting", () => {
    it("Node can be allowed only by owner", async () => {
      await expect(allowNode(node1)).to.not.revert(ethers);

      await expect(idosStaking.connect(user1).allowNode(node1))
        .to.be.revertedWithCustomError(idosStaking, "OwnableUnauthorizedAccount");
    });

    it("Node can be disallowed only by owner", async () => {
      await expect(idosStaking.disallowNode(node1)).to.not.revert(ethers);

      await expect(idosStaking.connect(user1).disallowNode(node1))
        .to.be.revertedWithCustomError(idosStaking, "OwnableUnauthorizedAccount");
    });

    it("Emits events", async () => {
      await expect(allowNode(node1))
        .to.emit(idosStaking, "Allowed").withArgs(node1.address);

      await expect(idosStaking.disallowNode(node2))
        .to.emit(idosStaking, "Disallowed").withArgs(node2.address);
    });
  });

  describe("Staking", () => {
    describe("Before starting", () => {
      it("Can't stake yet", async () => {
        await idosStaking.allowNode(node1);

        await expect(stake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "NotStarted");
      });
    });

    describe("After starting", () => {
      beforeEach(async () => {
        await networkHelpers.time.increaseTo(evmTimestamp(2026, 11));
      });

      it("Epochs last 1 day", async () => {
        expect(await idosStaking.EPOCH_LENGTH()).to.equal(Duration.days(1));

        for (let i = 0; i < 10; i++) {
          expect(await idosStaking.currentEpoch()).to.equal(i*100);
          await networkHelpers.time.increase(Duration.days(100));
        }
      });

      it("Can't stake against zero address", async () => {
        await expect(stake(user1, ZERO_ACCT, 100))
          .to.be.revertedWithCustomError(idosStaking, "ZeroAddressNode");
      });

      it("Can't stake against slashed node", async () => {
        await allowNode(node1);

        await stake(user1, node1, 1);
        await slash(node1);

        await expect(stake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "NodeIsSlashed");
      });

      it("Can't stake against non-allowed node", async () => {
        await expect(stake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "NodeIsNotAllowed");
      });

      it("Can only stake positive amounts", async () => {
        await allowNode(node1);

        await expect(stake(user1, node1, 0))
          .to.be.revertedWithCustomError(idosStaking, "AmountNotPositive")
          .withArgs(0);
      });

      it("Emits events", async () => {
        await allowNode(node1);

        await expect(stake(user1, node1, 100))
          .to.emit(idosStaking, "Staked")
          .withArgs(user1.address, node1.address, 100);
      });

      it("Works", async () => {
        await allowNode(node1);
        await allowNode(node2);

        await stake(user1, node1, 100);

        expect(await stakeByNodeByUser(user1, node1)).to.equal(100);
        expect(await getNodeStake(node1)).to.equal(100);
        expect((await getUserStake(user1)).activeStake).to.equal(100);
        expect(await idosToken.balanceOf(user1)).to.equal(900);
        expect(await idosToken.balanceOf(idosStaking)).to.equal(10100);

        await stake(user1, node1, 100);

        expect(await stakeByNodeByUser(user1, node1)).to.equal(200);
        expect(await getNodeStake(node1)).to.equal(200);
        expect((await getUserStake(user1)).activeStake).to.equal(200);
        expect(await idosToken.balanceOf(user1)).to.equal(800);
        expect(await idosToken.balanceOf(idosStaking)).to.equal(10200);

        await stake(user1, node2, 100);

        expect(await stakeByNodeByUser(user1, node2)).to.equal(100);
        expect(await getNodeStake(node2)).to.equal(100);
        expect((await getUserStake(user1)).activeStake).to.equal(300);
        expect(await idosToken.balanceOf(user1)).to.equal(700);
        expect(await idosToken.balanceOf(idosStaking)).to.equal(10300);

        await stake(user2, node2, 100);

        expect(await stakeByNodeByUser(user2, node2)).to.equal(100);
        expect(await getNodeStake(node2)).to.equal(200);
        expect((await getUserStake(user2)).activeStake).to.equal(100);
        expect(await idosToken.balanceOf(user2)).to.equal(900);
        expect(await idosToken.balanceOf(idosStaking)).to.equal(10400);
      });
    });
  });

  describe("Unstaking", () => {
    describe("Before starting", () => {
      it("Can't unstake yet", async () => {
        await expect(unstake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "NotStarted");
      });
    });

    describe("After starting", () => {
      beforeEach(async () => {
        await networkHelpers.time.increaseTo(evmTimestamp(2026, 11));
        await allowNode(node1);
        await stake(user1, node1, 100);
      });

      it("Can't unstake from zero address", async () => {
        await expect(unstake(user1, ZERO_ACCT, 100))
          .to.be.revertedWithCustomError(idosStaking, "ZeroAddressNode");
      });

      it("Can't unstake from slashed node", async () => {
        await slash(node1);

        await expect(unstake(user1, node1, 100))
          .to.be.revertedWithCustomError(idosStaking, "NodeIsSlashed");
      });

      it("Can only unstake positive amounts", async () => {
        await expect(unstake(user1, node1, 0))
          .to.be.revertedWithCustomError(idosStaking, "AmountNotPositive")
          .withArgs(0);
      });

      it("Can only unstake up to staked amount", async () => {
        await expect(unstake(user1, node1, 1000))
          .to.be.revertedWithCustomError(idosStaking, "AmountExceedsStake")
          .withArgs(1000, 100);

        expect(await stakeByNodeByUser(user1, node1)).to.equal(100);

        await stake(user1, node1, 900);

        await expect(unstake(user1, node1, 1000)).to.not.revert(ethers);

        expect(await stakeByNodeByUser(user1, node1)).to.equal(0);
      });

      it("Emits events", async () => {
        await stake(user1, node1, 100);

        await expect(unstake(user1, node1, 100))
          .to.emit(idosStaking, "Unstaked")
          .withArgs(user1.address, node1.address, 100);
      });

      it("Works", async () => {
        await unstake(user1, node1, 10);

        expect(await stakeByNodeByUser(user1, node1)).to.equal(90);
      });

      describe("Withdrawal", () => {
        it("Can't withdraw before delay", async () => {
          await unstake(user1, node1, 10);

          await expect(idosStaking.connect(user1).withdrawUnstaked())
            .to.be.revertedWithCustomError(idosStaking, "NoWithdrawableStake");
        });

        it("Emits events", async () => {
          await unstake(user1, node1, 100);

          await networkHelpers.time.increase(Duration.days(14));

          await expect(idosStaking.connect(user1).withdrawUnstaked())
            .to.emit(idosStaking, "UnstakedWithdraw")
            .withArgs(user1.address, 100);
        });

        it("Works", async () => {
          await unstake(user1, node1, 10);

          await networkHelpers.time.increase(Duration.days(1));

          await unstake(user1, node1, 10);

          await networkHelpers.time.increase(Duration.days(13));

          await idosStaking.connect(user1).withdrawUnstaked();

          expect(await idosToken.balanceOf(user1)).to.equal(910);

          await networkHelpers.time.increase(Duration.days(1));

          await idosStaking.connect(user1).withdrawUnstaked();

          expect(await idosToken.balanceOf(user1)).to.equal(920);
        });
      });
    });
  });

  describe("Slashing", () => {
    beforeEach(async () => {
      await networkHelpers.time.increaseTo(evmTimestamp(2026, 11));
      await allowNode(node1);
    });

    it("Unknown nodes can't be slashed", async () => {
      await expect(idosStaking.slash(node1.address))
        .to.be.revertedWithCustomError(idosStaking, "NodeIsUnknown")
        .withArgs(node1.address);

      const randomAddress = ethers.Wallet.createRandom().address;

      await expect(idosStaking.slash(randomAddress))
        .to.be.revertedWithCustomError(idosStaking, "NodeIsUnknown")
        .withArgs(randomAddress);
    });

    it("Slashed nodes can't be slashed", async () => {
      await stake(user1, node1, 100);
      await slash(node1);

      await expect(idosStaking.slash(node1.address))
        .to.be.revertedWithCustomError(idosStaking, "NodeIsSlashed")
        .withArgs(node1.address);
    });

    it("Known nodes can be slashed only by owner", async () => {
      await stake(user1, node1, 100);

      await expect(idosStaking.slash(node1.address)).to.not.revert(ethers);

      await expect(idosStaking.connect(user1).slash(node1.address))
        .to.be.revertedWithCustomError(idosStaking, "OwnableUnauthorizedAccount");
    });

    describe("Withdrawing slashed stakes", () => {
      beforeEach(async () => {
        await stake(user1, node1, 100);
        await idosStaking.slash(node1);
      });

      it("Can be done only by owner", async () => {
        await expect(idosStaking.withdrawSlashedStakes()).to.not.revert(ethers);

        await expect(idosStaking.connect(user1).withdrawSlashedStakes())
          .to.be.revertedWithCustomError(idosStaking, "OwnableUnauthorizedAccount");
      });

      it("Emits events", async () => {
        await expect(idosStaking.withdrawSlashedStakes())
          .to.emit(idosStaking, "SlashedWithdraw").withArgs(100);
      });

      it("Works", async () => {
        const prevBalance = await idosToken.balanceOf(owner);

        await idosStaking.withdrawSlashedStakes();

        expect(await idosToken.balanceOf(owner)).to.equal(prevBalance + 100n);

        await expect(idosStaking.withdrawSlashedStakes())
          .to.be.revertedWithCustomError(idosStaking, "NoWithdrawableSlashedStakes");
      });
    });
  });

  describe("Rewards", () => {
    beforeEach(async () => {
      await networkHelpers.time.increaseTo(evmTimestamp(2026, 11));
      await Promise.all([node1, node2, node3].map(node => allowNode(node)));
    });

    // Ensure sniping prevention: first staker in epoch
    // could otherwise immediately withdraw all rewards
    it("Count only past epochs", async () => {
      await stake(user1, node1, 100);

      expect(await withdrawableReward(user1)).to.equal(0);
    });

    it("Ignore slashed stakes", async () => {
      await stake(user1, node1, 50);
      await stake(user1, node2, 50);
      await stake(user2, node2, 300);
      await idosStaking.slash(node1);
      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(14);
      expect(await withdrawableReward(user2)).to.equal(85);
    });

    it("changes value according to the epoch reward", async () => {
      await stake(user1, node1, 100);
      // Set to 100 at constructor
      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(100);
      await idosStaking.connect(user1).withdrawReward();
      expect(await idosToken.balanceOf(user1)).to.equal(1000-100+100);

      await idosStaking.setEpochReward(200);
      await networkHelpers.time.increase(Duration.days(1));
      expect(await withdrawableReward(user1)).to.equal(200);
    });

    it("changes value according to the epoch reward and keeps track of past epoch rewards", async () => {
      await stake(user1, node1, 100);
      // Set to 100 at constructor
      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(100);

      await idosStaking.setEpochReward(200);
      await networkHelpers.time.increase(Duration.days(1));
      expect(await withdrawableReward(user1)).to.equal(100 + 200);

      await idosStaking.setEpochReward(300);
      await networkHelpers.time.increase(Duration.days(1));
      expect(await withdrawableReward(user1)).to.equal(100 + 200 + 300);
    });

    it("Works I", async () => {
      await stake(user1, node1, 100);
      await stake(user2, node1, 300);
      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(25);
      await idosStaking.connect(user1).withdrawReward();
      expect(await idosToken.balanceOf(user1)).to.equal(1000-100+25);

      expect(await withdrawableReward(user2)).to.equal(75);
      await idosStaking.connect(user2).withdrawReward();
      expect(await idosToken.balanceOf(user2)).to.equal(1000-300+75);

      await expect(idosStaking.connect(user1).withdrawReward())
        .to.be.revertedWithCustomError(idosStaking, "NoWithdrawableRewards");
    });

    it("Works II", async () => {
      await stake(user1, node1, 50);
      await stake(user1, node2, 50);
      await stake(user2, node2, 300);

      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(25);
      expect(await withdrawableReward(user2)).to.equal(75);
      expect(await withdrawableReward(user3)).to.equal(0);

      await networkHelpers.time.increase(Duration.days(9));

      expect(await withdrawableReward(user1)).to.equal(250);
      expect(await withdrawableReward(user2)).to.equal(750);
      expect(await withdrawableReward(user3)).to.equal(0);

      await idosStaking.slash(node2);

      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(350);
      expect(await withdrawableReward(user2)).to.equal(750);
      expect(await withdrawableReward(user3)).to.equal(0);

      await networkHelpers.time.increase(Duration.days(10));

      expect(await withdrawableReward(user1)).to.equal(1350);
      expect(await withdrawableReward(user2)).to.equal(750);
      expect(await withdrawableReward(user3)).to.equal(0);

      await stake(user2, node1, 100);
      await stake(user3, node1, 100);
      await stake(user3, node3, 200);

      await networkHelpers.time.increase(Duration.days(1));

      expect(await withdrawableReward(user1)).to.equal(1361);
      expect(await withdrawableReward(user2)).to.equal(772);
      expect(await withdrawableReward(user3)).to.equal(66);
    });

    it("Works III", async () => {
      await stake(user1, node1, 50);
      await stake(user1, node2, 50);
      await stake(user2, node2, 300);

      await networkHelpers.time.increase(Duration.days(10));

      expect(await withdrawableReward(user1)).to.equal(250);
      expect(await withdrawableReward(user2)).to.equal(750);
      expect(await withdrawableReward(user3)).to.equal(0);

      await stake(user3, node1, 100);
      await unstake(user1, node2, 50);

      await idosStaking.connect(user1).withdrawReward()

      expect(await withdrawableReward(user1)).to.equal(0);
      expect(await withdrawableReward(user2)).to.equal(750);
      expect(await withdrawableReward(user3)).to.equal(0);

      await networkHelpers.time.increase(Duration.days(10));

      expect(await withdrawableReward(user1)).to.equal(110);
      expect(await withdrawableReward(user2)).to.equal(1410);
      expect(await withdrawableReward(user3)).to.equal(220);

      await networkHelpers.time.increase(Duration.days(5));

      await idosStaking.connect(user1).withdrawUnstaked();

      await networkHelpers.time.increase(Duration.days(5));

      expect(await withdrawableReward(user1)).to.equal(220);
      expect(await withdrawableReward(user2)).to.equal(2070);
      expect(await withdrawableReward(user3)).to.equal(440);
    });
  });
});
