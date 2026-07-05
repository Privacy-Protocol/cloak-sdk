#!/usr/bin/env bash
# Compile the circuit, generate the keccak (EVM) verification key + Solidity
# verifier, and regenerate the on-chain proof fixture consumed by the Foundry
# tests. Requires nargo (1.0.0-beta.16) and bb (3.0.0-nightly.20251104).
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$(cd "$CIRCUITS_DIR/../contracts" && pwd)"
cd "$CIRCUITS_DIR"

echo "==> nargo test"
nargo test

echo "==> nargo compile"
nargo compile

echo "==> write_vk (keccak / EVM)"
bb write_vk --scheme ultra_honk --oracle_hash keccak -b target/cloak_spend.json -o target

echo "==> write_solidity_verifier"
bb write_solidity_verifier --scheme ultra_honk --optimized -k target/vk -o target/HonkVerifier.sol
cp target/HonkVerifier.sol "$CONTRACTS_DIR/src/verifiers/HonkVerifier.sol"

echo "==> proof fixture"
( cd spend && nargo execute cloak_witness )
bb prove --scheme ultra_honk --oracle_hash keccak \
  -b target/cloak_spend.json -w target/cloak_witness.gz -o target/proof_out
cp target/proof_out/proof "$CONTRACTS_DIR/test/fixtures/spend_proof.bin"
cp target/proof_out/public_inputs "$CONTRACTS_DIR/test/fixtures/spend_public_inputs.bin"

echo "==> done"
