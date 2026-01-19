import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("IDOSNodeStaking", (m) => {
  const initialOwner = m.getParameter("initialOwner");

  const startTime = m.getParameter("startTime", Math.floor(Date.now() / 1000));
  const epochReward = m.getParameter("epochReward", 0n);

  const idosToken = m.contract("IDOSToken", [initialOwner]);

  const nodeStaking = m.contract("IDOSNodeStaking", [idosToken, initialOwner, startTime, epochReward]);

  return { idosToken, nodeStaking };
});
