import type { Address } from "viem";

/** A Cloak deployment on a specific chain. */
export interface CloakDeployment {
  chainId: number;
  poolAddress: Address;
  verifierAddress: Address;
  /** Block the pool was deployed at — pass as `deployBlock` to speed up sync. */
  deployBlock: bigint;
  /** Hosted relayer for this deployment. */
  relayerUrl: string;
}

/** Canonical, PP-maintained deployments. */
export const deployments = {
  sepolia: {
    chainId: 11155111,
    poolAddress: "0x8Aa022f478F42c7c0Da14B5D9Ae8EFD89FC47c97",
    verifierAddress: "0x87d1D1E6345A1d80DaA60B2B153d7F64d0BBfdd7",
    deployBlock: 11207404n,
    relayerUrl: "https://cloak-relayer.onrender.com",
  },
  baseSepolia: {
    chainId: 84532,
    poolAddress: "0xBBd45437D3132AB6F2cF44c1696E634EEdA057fE",
    verifierAddress: "0xAb8814Efd0C7a447C00Bc59F441134C23B15750F",
    deployBlock: 44318778n,
    relayerUrl: "https://cloak-relayer-base.onrender.com",
  },
} as const satisfies Record<string, CloakDeployment>;

/** Look up a deployment by chain id. */
export function getDeployment(chainId: number): CloakDeployment | undefined {
  return Object.values(deployments).find((d) => d.chainId === chainId);
}
