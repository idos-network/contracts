import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("IDOSNodeStaking", (m) => {
  const deployer = m.getAccount(0);

  const startTime = m.getParameter("startTime", Math.floor(Date.now() / 1000));
  const epochReward = m.getParameter("epochReward", 0n);

  const idosToken = m.contract("IDOSToken", [deployer]);

  const nodeStaking = m.contract("IDOSNodeStaking", [idosToken, deployer, startTime, epochReward]);

  return { idosToken, nodeStaking };
});
