import { getAddress } from "viem";
import { FIELD_PRIME, ETH_ADDRESS } from "./constants";
import { poseidon2 } from "./poseidon";

/**
 * A spendable note. `secret` and `nullifierKey` are the private witness; the
 * rest is derivable or discovered on-chain. Persist these — losing `secret`
 * or `nullifierKey` means the funds are unrecoverable.
 */
export interface Note {
  secret: bigint;
  nullifierKey: bigint;
  /** address(0) for ETH, else the ERC20 token address. */
  asset: `0x${string}`;
  amount: bigint;
  /** Assigned once the commitment is found in the tree (from events). */
  leafIndex?: number;
  /** leaf = H(H(secret, nullifierKey, assetField), amount). */
  commitment?: bigint;
  /** Origin of the note; "claim" notes are pending until harvested on-chain. */
  kind?: "deposit" | "change" | "claim";
  /** Set once the note has been consumed by a spend. */
  spent?: boolean;
}

/** The asset address as a field element (0 for ETH). */
export function assetField(asset: `0x${string}`): bigint {
  return BigInt(asset);
}

/** Cryptographically-random field element. */
export function randomField(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD_PRIME;
}

/** inner = H(secret, nullifierKey, assetField). */
export async function computeInner(
  secret: bigint,
  nullifierKey: bigint,
  asset: `0x${string}`,
): Promise<bigint> {
  return poseidon2([secret, nullifierKey, assetField(asset)]);
}

/** leaf/commitment = H(inner, amount). */
export async function computeCommitment(note: Note): Promise<bigint> {
  const inner = await computeInner(note.secret, note.nullifierKey, note.asset);
  return poseidon2([inner, note.amount]);
}

/** nullifier = H(nullifierKey, leafIndex). */
export async function computeNullifier(nullifierKey: bigint, leafIndex: number): Promise<bigint> {
  return poseidon2([nullifierKey, BigInt(leafIndex)]);
}

/** Create a fresh note with random secret + nullifier key. */
export async function createNote(asset: `0x${string}`, amount: bigint): Promise<Note> {
  const normalizedAsset = asset === ETH_ADDRESS ? ETH_ADDRESS : (getAddress(asset) as `0x${string}`);
  const note: Note = {
    secret: randomField(),
    nullifierKey: randomField(),
    asset: normalizedAsset,
    amount,
  };
  note.commitment = await computeCommitment(note);
  return note;
}
