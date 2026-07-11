# Cloak Contracts

Foundry project for Cloak's on-chain layer. See the [repository README](../README.md) for the full protocol overview.

| Contract | Role |
| --- | --- |
| `CloakPool` | The privacy pool: `deposit(commitment, asset, amount)` public entry, `spend(SpendProof, Intent)` ZK-gated path. Maintains a depth-20 incremental Poseidon2 Merkle tree with a 64-root ring buffer, tracks nullifiers, deploys ephemeral proxies (CREATE2, salt = nullifierHash), executes intents, and harvests returned funds into claim notes. |
| `CloakProxy` | Single-use ephemeral executor deployed per spend — the address contracts see instead of the user's. |
| `Poseidon2MerkleTree` | Incremental Merkle tree with Yul-optimized Poseidon2 (via `poseidon2-evm`). |
| `HonkVerifier` | Generated UltraHonk verifier for the `cloak_spend` circuit (output of `circuits/scripts/build.sh`). |

## Build & test

```bash
forge build
forge test          # 16 tests: full lifecycle, Poseidon2 cross-compat vectors, real-proof verification
```

`test/HonkVerifier.t.sol` verifies a real SDK-generated proof fixture on-chain — the strongest guarantee that circuit, verifier, and SDK agree.

## Configuration notes

- The optimizer settings in [`foundry.toml`](./foundry.toml) (`optimizer = true`, `optimizer_runs = 1`, `bytecode_hash = "none"`) are **required**: the generated verifier and the pool exceed the 24 KB EIP-170 limit without them. Do not enable `via_ir` — it hits stack-too-deep in the generated verifier.
- Circuit public-input order must match `CloakPool.spend`: `[root, nullifier_hash, asset, spend_value, fee, change_commitment, intent_hash]`. If you regenerate the verifier, regenerate circuit + verifier + SDK fixtures together.

## Deploy

```bash
# Set SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY (see .env.example)
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
```

Current Sepolia deployment: `CloakPool` [`0x8Aa022f478F42c7c0Da14B5D9Ae8EFD89FC47c97`](https://sepolia.etherscan.io/address/0x8Aa022f478F42c7c0Da14B5D9Ae8EFD89FC47c97), `HonkVerifier` [`0x87d1D1E6345A1d80DaA60B2B153d7F64d0BBfdd7`](https://sepolia.etherscan.io/address/0x87d1D1E6345A1d80DaA60B2B153d7F64d0BBfdd7) (block `11207404`).
