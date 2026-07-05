export { createCloakClient, CloakClient } from "./client";
export type { CloakConfig, RelayerInfo, SendParams, SendResult } from "./client";

export type { Note } from "./note";
export {
  createNote,
  computeCommitment,
  computeNullifier,
  computeInner,
  assetField,
  randomField,
} from "./note";

export { MerkleTree } from "./tree";
export { poseidon2, poseidon2Pair, destroyPoseidon } from "./poseidon";
export { proveSpend } from "./prover";
export type { SpendWitness, Proof } from "./prover";

export { computeIntentHash, toField32 } from "./intent";
export type { Intent } from "./intent";

export { MemoryNoteStore, LocalStorageNoteStore } from "./store";
export type { NoteStore } from "./store";

export { cloakPoolAbi, erc20Abi } from "./abi";
export { FIELD_PRIME, TREE_HEIGHT, ZERO_VALUE, ETH_ADDRESS } from "./constants";

export { deployments, getDeployment } from "./deployments";
export type { CloakDeployment } from "./deployments";
