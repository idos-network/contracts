import {
  type Chain,
  Hex,
  type LocalAccount,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { arbitrum, arbitrumSepolia, sepolia } from "viem/chains";
import { assertCondition } from "./lib.js";
import { privateKeyToAccount, PrivateKeyToAccountOptions } from "viem/accounts";

const SUPPORTED_CHAINS: Record<string, Chain> = {
  [String(arbitrumSepolia.id)]: arbitrumSepolia,
  [String(arbitrum.id)]: arbitrum,
  [String(sepolia.id)]: sepolia,
};

export function resolveChain(chainId: string): Chain {
  const chain = SUPPORTED_CHAINS[chainId];
  assertCondition(
    chain !== undefined,
    `Unsupported CHAIN_ID: ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
  );
  return chain;
}

export async function validateRpcChainId(publicClient: PublicClient, chain: Chain): Promise<void> {
  const rpcChainId = await publicClient.getChainId();
  assertCondition(
    rpcChainId === chain.id,
    `RPC_URL points to chain ${rpcChainId}, expected ${chain.id} (${chain.name}).`,
  );
}

export async function chainSetup(
  chainId: string,
  rpcUrl: string,
  accountPrivateKey: Hex,
  accountOptions?: PrivateKeyToAccountOptions,
) {
  const chain = resolveChain(chainId);
  const account = privateKeyToAccount(accountPrivateKey, accountOptions);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  await validateRpcChainId(publicClient, chain);

  return { chain, account, publicClient, walletClient };
}
