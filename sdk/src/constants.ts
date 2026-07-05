import { keccak256, toBytes } from "viem";

/** BN254 scalar field prime — the field all Poseidon2 values live in. */
export const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Merkle tree depth. Must equal `TREE_HEIGHT` in the circuit and `LEVELS` in CloakPool. */
export const TREE_HEIGHT = 20;

/**
 * Empty-leaf value, mirrored from Poseidon2MerkleTree.ZERO_VALUE:
 * keccak256("cloak.empty.leaf.v1") % FIELD_PRIME.
 */
export const ZERO_VALUE =
  BigInt(keccak256(toBytes("cloak.empty.leaf.v1"))) % FIELD_PRIME;

/** Native ETH is represented as asset address(0). */
export const ETH_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
