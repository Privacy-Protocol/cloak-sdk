import { describe, it, expect, afterAll } from "vitest";
import { hexToBytes } from "viem";
import { proveSpend, verifySpend } from "../src/prover";
import { MerkleTree } from "../src/tree";
import { computeCommitment, computeNullifier, computeInner, type Note } from "../src/note";
import { poseidon2, destroyPoseidon } from "../src/poseidon";
import { ETH_ADDRESS } from "../src/constants";

// End-to-end proving: build a note + tree exactly as the client would, prove a
// spend, and confirm the proof verifies and has the on-chain proof size.
// The generated Solidity verifier expects a 7872-byte proof + 7 public inputs
// (see contracts/test/HonkVerifier.t.sol).
describe("proveSpend end-to-end", () => {
  afterAll(async () => {
    await destroyPoseidon();
  });

  it("produces an on-chain-sized proof that verifies", async () => {
    const note: Note = {
      secret: 12345n,
      nullifierKey: 67890n,
      asset: ETH_ADDRESS,
      amount: 1_000_000_000_000_000_000n,
    };
    note.commitment = await computeCommitment(note);

    // Single-leaf tree, note at index 0.
    const tree = await MerkleTree.fromLeaves([note.commitment]);
    const { siblings, root } = tree.proof(0);

    const spendValue = 300_000_000_000_000_000n;
    const fee = 1_000_000_000_000_000n;
    const changeAmount = note.amount - spendValue - fee;

    const changeSecret = 1111n;
    const changeNullifierKey = 2222n;
    const changeInner = await computeInner(changeSecret, changeNullifierKey, ETH_ADDRESS);
    const changeCommitment = await poseidon2([changeInner, changeAmount]);

    const nullifierHash = await computeNullifier(note.nullifierKey, 0);

    const { proof, publicInputs } = await proveSpend({
      root,
      nullifierHash,
      asset: 0n,
      spendValue,
      fee,
      changeCommitment,
      intentHash: 123456789n,
      secret: note.secret,
      nullifierKey: note.nullifierKey,
      amount: note.amount,
      leafIndex: 0,
      siblingPath: siblings,
      changeSecret,
      changeNullifierKey,
    });

    expect(publicInputs).toHaveLength(7);
    // Proof bytes must match what the Solidity verifier expects.
    expect(hexToBytes(proof).length).toBe(7872);

    const ok = await verifySpend(hexToBytes(proof), publicInputs);
    expect(ok).toBe(true);
  }, 120_000);
});
