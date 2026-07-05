import { encodeAbiParameters, keccak256, toHex, type Hex } from "viem";
import { FIELD_PRIME } from "./constants";

/** Cleartext execution intent, matching CloakPool.Intent. */
export interface Intent {
  asset: `0x${string}`;
  target: `0x${string}`;
  data: Hex;
  relayer: `0x${string}`;
  claimInner: Hex;
  returnAsset: `0x${string}`;
}

/**
 * Recompute the intent hash exactly as CloakPool._intentHash does:
 * keccak256(abi.encode(chainId, pool, target, keccak256(data), relayer,
 * claimInner, returnAsset)) % FIELD_PRIME. Domain-separated by chain + pool so
 * a proof can't be replayed elsewhere.
 */
export function computeIntentHash(chainId: number, pool: `0x${string}`, intent: Intent): bigint {
  const dataHash = keccak256(intent.data);
  const encoded = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "address" },
      { type: "bytes32" },
      { type: "address" },
    ],
    [BigInt(chainId), pool, intent.target, dataHash, intent.relayer, intent.claimInner, intent.returnAsset],
  );
  return BigInt(keccak256(encoded)) % FIELD_PRIME;
}

/** bigint -> 0x-padded bytes32. */
export function toField32(v: bigint): Hex {
  return toHex(v, { size: 32 });
}
