# Cloak

Anonymous transactions for any dapp. Cloak is a privacy-pools layer: users
deposit funds under a commitment, then forward transactions, withdraw, or claim
returned funds through zero-knowledge proofs and a relayer — so the on-chain
trail never links back to them. Builders integrate a TypeScript SDK; there are
no contracts to write and nothing to deploy.

## Repository layout

| Directory | What it is |
| --- | --- |
| [`circuits/`](circuits) | Noir `cloak_spend` circuit (UltraHonk) — note ownership, nullifier, amount conservation, and intent binding. |
| [`contracts/`](contracts) | Foundry contracts: `CloakPool` (pool + CREATE2 proxy factory + Poseidon2 Merkle tree), the generated `HonkVerifier`, and `CloakProxy`. |
| [`relayer/`](relayer) | Rust (axum + alloy) relayer + gas sponsor. Deployable to Render. |
| [`sdk/`](sdk) | `@privacy-protocol/cloak` — viem core + wagmi React hooks, in-browser/Node proving. |

## How the pieces fit

```
user ── deposit(commitment) ─────────────▶ CloakPool  (funds pooled, leaf added)
      \
       \  build zk proof (SDK, noir_js + bb.js)
        \ POST /relay ──▶ Relayer ── spend(proof, intent) ──▶ CloakPool
                                                                 │ verifies proof
                                                                 │ deploys ephemeral CloakProxy (CREATE2)
                                                                 ▼ executes intent; change + returns become new notes
```

The fee amount and recipient are bound into every proof, so the relayer is
trusted for liveness only — never for safety.

## Cryptographic integrity (verified end-to-end)

- Poseidon2 is identical in Noir, the Solidity pool (`poseidon2-evm`), and the SDK (`@aztec/bb.js`) — pinned to shared reference vectors in tests.
- An SDK-generated UltraHonk `keccakZK` proof verifies on the generated on-chain Solidity verifier (`contracts/test/HonkVerifier.t.sol`, fed an SDK proof).
- The Merkle tree, commitments, and nullifiers match across circuit, contract, and SDK.

## Build & test

```bash
# circuits + verifier + proof fixture
cd circuits && ./scripts/build.sh

# contracts
cd contracts && forge test

# relayer
cd relayer && cargo build --release

# sdk
cd sdk && npm install && npm run build && npm test
```

## Deploy

1. Set `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY` (see `contracts/.env.example`), then
   `cd contracts && forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify` — note the `CloakPool` address. (The contracts require the Solidity optimizer, already set in `foundry.toml`, to fit under the 24 KB code-size limit.)
2. Deploy the relayer (see [`relayer/README.md`](relayer/README.md)); set `POOL_ADDRESS`, fund the relayer key.
3. Point the SDK at the pool address + relayer URL.

## Status

v1 targets Sepolia (ETH + ERC-20), arbitrary amounts, zero-fee sponsored
relaying. Association-set/compliance proofs and async oracle flows are designed
for but not enabled. **Not audited — do not use with mainnet funds.**

Docs: `interface/content/cloak/` (rendered at `/docs/cloak`).
