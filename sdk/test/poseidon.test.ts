import { describe, it, expect, afterAll } from "vitest";
import { poseidon2, destroyPoseidon } from "../src/poseidon";

// Reference values printed by the Noir `poseidon` crate (v0.2.6). If bb.js
// drifts from Noir, everything breaks silently — so pin it here.
describe("poseidon2 matches Noir", () => {
  afterAll(async () => {
    await destroyPoseidon();
  });

  it("hash([1,2])", async () => {
    expect(await poseidon2([1n, 2n])).toBe(
      0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n,
    );
  });

  it("hash([12345,67890,0])", async () => {
    expect(await poseidon2([12345n, 67890n, 0n])).toBe(
      0x1cab44acc2f05990337d4facca22069ce7f4614f9ed3f81cd3a7e122f4beae79n,
    );
  });

  it("hash([0xabcdef, 1e18])", async () => {
    expect(await poseidon2([0xabcdefn, 1000000000000000000n])).toBe(
      0x1fae2081c6e18fadeb5f37ede90ea8439027421d675ff16a58c42a8efebeff15n,
    );
  });
});
