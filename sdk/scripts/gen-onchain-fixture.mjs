// Generate a spend proof with the SDK and write it to the Foundry fixture
// files, so contracts/test/HonkVerifier.t.sol verifies an SDK-produced proof
// on-chain. Decisive check that the SDK -> chain path works.
import { writeFileSync } from "node:fs";
import { hexToBytes } from "viem";
import { proveSpend } from "../dist/index.js";

// Same witness as the committed fixture (siblings = [7;20], so root is fixed).
const root = 0x0b9fc4ababf7f7b0935b347044cd5ab3e9e8c1346056874c30c75b2f3dc16499n;
const nullifierHash = 0x301d3196b8253b469649f5c92426858467ff77b88ed8759bec5a4bf856089ba6n;
const changeCommitment = 0x25ba914c0eab91c6a85df62529a923e77e9435539a2944a7d0482b02a738f9d4n;

const { proof, publicInputs } = await proveSpend({
  root,
  nullifierHash,
  asset: 0n,
  spendValue: 300000000000000000n,
  fee: 1000000000000000n,
  changeCommitment,
  intentHash: 123456789n,
  secret: 12345n,
  nullifierKey: 67890n,
  amount: 1000000000000000000n,
  leafIndex: 0,
  siblingPath: Array(20).fill(7n),
  changeSecret: 1111n,
  changeNullifierKey: 2222n,
});

const proofBytes = hexToBytes(proof);
const piBytes = new Uint8Array(publicInputs.length * 32);
publicInputs.forEach((pi, i) => piBytes.set(hexToBytes(pi), i * 32));

const dir = "../../contracts/test/fixtures";
writeFileSync(new URL(`${dir}/spend_proof.bin`, import.meta.url), proofBytes);
writeFileSync(new URL(`${dir}/spend_public_inputs.bin`, import.meta.url), piBytes);
console.log(`wrote SDK proof (${proofBytes.length} bytes) + ${publicInputs.length} public inputs`);
