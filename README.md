# Contracts

See the [Audit report](./NM0731-FINAL_IDOS.pdf)

## Setup

Install [Foundry](https://getfoundry.sh/) and dependencies:

```bash
pnpm i                    # OpenZeppelin contracts (for remappings)
forge install              # Ensure lib/forge-std is installed
```

## Build

```bash
forge build
```

## Test

```bash
forge test
```

## Deploy

IDOSToken and IDOSNodeStaking are already deployed on Arbitrum One (42161) and Arbitrum Sepolia (421614). Addresses are in `script/deployments.json` (migrated from Hardhat Ignition).

To run the deployment script (skips deployment on known chains, deploys otherwise):

```bash
# Load .env and run (Arbitrum One - will skip, already deployed)
forge script script/DeployIDOSNodeStaking.s.sol --rpc-url arbitrumOne --broadcast

# Deploy to a new chain (requires INITIAL_OWNER in env)
INITIAL_OWNER=0x... forge script script/DeployIDOSNodeStaking.s.sol --rpc-url sepolia --broadcast
```

## Verify on Etherscan

```bash
forge verify-contract <CONTRACT_ADDRESS> <CONTRACT_NAME> --chain-id 42161 --etherscan-api-key $ETHERSCAN_API_KEY
```

See also gas experiments here: https://github.com/idos-network/node-staking-gas-tests

![contract list](assets/contracts.png)
