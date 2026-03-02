import {
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia, sepolia } from "viem/chains";
import { assertCondition } from "./lib.js";

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

export async function chainSetup(chainId: string, rpcUrl: string) {
  const chain = resolveChain(chainId);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  await validateRpcChainId(publicClient, chain);
  return { chain, transport, publicClient };
}

export function makeWallet(chain: Chain, transport: ReturnType<typeof http>, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain, transport });
  return { account, walletClient };
}
