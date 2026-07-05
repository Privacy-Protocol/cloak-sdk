import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { toHex, type Hex } from "viem";
import circuit from "./circuit/cloak_spend.json";
import { TREE_HEIGHT } from "./constants";

/** All inputs the `cloak_spend` circuit needs to produce a proof. */
export interface SpendWitness {
  // public
  root: bigint;
  nullifierHash: bigint;
  asset: bigint;
  spendValue: bigint;
  fee: bigint;
  changeCommitment: bigint;
  intentHash: bigint;
  // private
  secret: bigint;
  nullifierKey: bigint;
  amount: bigint;
  leafIndex: number;
  siblingPath: bigint[];
  changeSecret: bigint;
  changeNullifierKey: bigint;
}

export interface Proof {
  /** Proof bytes as hex, ready to pass to CloakPool.spend / the relayer. */
  proof: Hex;
  /** The 7 public inputs the circuit exposes (for debugging/verification). */
  publicInputs: Hex[];
}

let backend: UltraHonkBackend | null = null;
let noir: Noir | null = null;

function init(): { noir: Noir; backend: UltraHonkBackend } {
  if (!backend) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backend = new UltraHonkBackend((circuit as any).bytecode);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!noir) noir = new Noir(circuit as any);
  return { noir, backend };
}

const f = (v: bigint) => toHex(v, { size: 32 });

/**
 * Generate an UltraHonk (keccak) proof for a spend. The keccak flavour is
 * required for on-chain verification by the generated Solidity verifier.
 */
export async function proveSpend(w: SpendWitness): Promise<Proof> {
  const { noir, backend } = init();

  if (w.siblingPath.length !== TREE_HEIGHT) {
    throw new Error(`siblingPath must have ${TREE_HEIGHT} entries`);
  }

  const inputs = {
    root: f(w.root),
    nullifier_hash: f(w.nullifierHash),
    asset: f(w.asset),
    spend_value: w.spendValue.toString(),
    fee: w.fee.toString(),
    change_commitment: f(w.changeCommitment),
    intent_hash: f(w.intentHash),
    secret: f(w.secret),
    nullifier_key: f(w.nullifierKey),
    amount: w.amount.toString(),
    leaf_index: w.leafIndex.toString(),
    sibling_path: w.siblingPath.map(f),
    change_secret: f(w.changeSecret),
    change_nullifier_key: f(w.changeNullifierKey),
  };

  const { witness } = await noir.execute(inputs);
  // keccakZK: keccak challenges (EVM-verifiable) + the ZK Honk flavour the
  // generated Solidity verifier expects.
  const { proof, publicInputs } = await backend.generateProof(witness, { keccakZK: true });

  return {
    proof: toHex(proof),
    publicInputs: publicInputs as Hex[],
  };
}

/** Verify a spend proof off-chain (keccak flavour). Useful in tests/tooling. */
export async function verifySpend(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
  const { backend } = init();
  return backend.verifyProof({ proof, publicInputs }, { keccakZK: true });
}
