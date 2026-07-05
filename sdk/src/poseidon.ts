import { Barretenberg } from "@aztec/bb.js";

// Poseidon2 over BN254 via Barretenberg — the exact same implementation the
// Noir circuit and the on-chain poseidon2-evm library use, so commitments,
// nullifiers and roots computed here match both. (Cross-checked against Noir
// reference vectors in test/poseidon.test.ts.)

let bbPromise: Promise<Barretenberg> | null = null;

async function api(): Promise<Barretenberg> {
  if (!bbPromise) bbPromise = Barretenberg.new();
  return bbPromise;
}

/** Release the Barretenberg worker (optional; call when done in Node scripts). */
export async function destroyPoseidon(): Promise<void> {
  if (bbPromise) {
    const bb = await bbPromise;
    await bb.destroy();
    bbPromise = null;
  }
}

/** 32-byte big-endian encoding of a field element. */
function toBE32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function fromBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Poseidon2 hash of arbitrary-arity field inputs. */
export async function poseidon2(inputs: bigint[]): Promise<bigint> {
  const bb = await api();
  const { hash } = await bb.poseidon2Hash({ inputs: inputs.map(toBE32) });
  return fromBE(Uint8Array.from(hash));
}

export async function poseidon2Pair(a: bigint, b: bigint): Promise<bigint> {
  return poseidon2([a, b]);
}
