# Cloak

**Anonymous transactions for any dapp — integrate an SDK, not a cryptography stack.**

[![npm](https://img.shields.io/npm/v/%40privacy-protocol%2Fcloak)](https://www.npmjs.com/package/@privacy-protocol/cloak)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Network: Sepolia](https://img.shields.io/badge/Network-Sepolia-8A2BE2)](#deployments)

Cloak lets you add **anonymous transactions** to any dapp without writing a circuit, deploying a contract, or running infrastructure. It is a privacy-pools layer: users deposit funds under a commitment, then forward transactions, withdraw, or claim returned funds through zero-knowledge proofs relayed on their behalf — so the on-chain trail never links back to them. Install a TypeScript package, call a few functions (or React hooks), and your users transact privately against contracts that are already deployed.

Cloak is part of [Privacy Protocol](https://www.privacyprotocol.org), a suite of open-source privacy tooling for EVM chains — alongside [Beacon](https://github.com/Privacy-Protocol/beacon) (ZK proof oracle) and [Cipher](https://github.com/Privacy-Protocol/cipher) (reusable confidential contracts).

📚 **Full documentation:** [privacyprotocol.org/docs/cloak](https://www.privacyprotocol.org/docs/cloak)

---

## What you get

- **Anonymous sends** — forward an arbitrary transaction (target + calldata + value) to any contract, executed by an ephemeral proxy instead of the user's address
- **Private withdrawals** — move funds to a fresh address with no visible link to the deposit
- **Claimable returns** — funds a forwarded call sends back are captured into a note only the user can withdraw
- **Gas sponsorship** — a relayer submits every spend, so the user never signs the on-chain transaction that would deanonymize them
- **No contracts to write or deploy** — the pool, verifier, proxy factory, and relayer already exist; you integrate the SDK

## Quick start

### Install

```bash
# Core (any TypeScript / JavaScript project)
npm install @privacy-protocol/cloak viem

# React
npm install @privacy-protocol/cloak viem wagmi @tanstack/react-query
```

The proving stack (`@noir-lang/noir_js`, `@aztec/bb.js`) is bundled at pinned versions for proof compatibility — no extra setup, proving runs in-browser or in Node.

### Core API

```typescript
import { createCloakClient, LocalStorageNoteStore, deployments, ETH_ADDRESS } from "@privacy-protocol/cloak"
import { createPublicClient, createWalletClient, custom, http } from "viem"
import { sepolia } from "viem/chains"

const cloak = createCloakClient({
  ...deployments.sepolia, // poolAddress, relayerUrl, chainId, deployBlock — batteries included
  publicClient: createPublicClient({ chain: sepolia, transport: http() }),
  walletClient: createWalletClient({ chain: sepolia, transport: custom(window.ethereum) }),
  store: new LocalStorageNoteStore(sepolia.id, deployments.sepolia.poolAddress),
})

// 1. Deposit (public — this is what builds the anonymity set)
const note = await cloak.deposit({ asset: ETH_ADDRESS, amount: 10n ** 17n })

// 2. Send anonymously — executed by an ephemeral proxy, relayed for you
await cloak.send({
  note,
  target: "0xSomeContract",
  data: encodeFunctionData({ abi, functionName: "mint", args: [1n] }),
  value: 5n * 10n ** 16n,
  returnAsset: ETH_ADDRESS,
})

// 3. Withdraw privately to a fresh address
await cloak.withdraw({ note, to: "0xFreshAddress" })

// 4. Claim funds a forwarded call sent back
await cloak.sync()
for (const claim of await cloak.getClaimables()) {
  await cloak.claim({ claimNote: claim, to: "0xFreshAddress" })
}
```

### React hooks

```tsx
import { CloakProvider, useDeposit, useCloakSend, useNotes, useClaimables } from "@privacy-protocol/cloak/react"
import { deployments } from "@privacy-protocol/cloak"

// Inside your WagmiProvider + QueryClientProvider:
<CloakProvider poolAddress={deployments.sepolia.poolAddress} relayerUrl={deployments.sepolia.relayerUrl}>
  <App />
</CloakProvider>

// Then in components: useDeposit(), useCloakSend(), useWithdraw(), useClaim(), useNotes(), useClaimables()
```

See the [quickstart](https://www.privacyprotocol.org/docs/cloak/quickstart), [API reference](https://www.privacyprotocol.org/docs/cloak/api-reference), and [React guide](https://www.privacyprotocol.org/docs/cloak/react) for the full walkthrough.

## How it works

```
user ── deposit(commitment) ─────────────▶ CloakPool  (funds pooled, leaf added)
      \
       \  build zk proof (SDK, in-browser)
        \ POST /relay ──▶ Relayer ── spend(proof, intent) ──▶ CloakPool
                                                                 │ verifies proof
                                                                 │ deploys ephemeral CloakProxy (CREATE2)
                                                                 ▼ executes intent; change + returns become new notes
```

The note model (Poseidon2 over BN254, identical across circuit, contracts, and SDK):

```
inner      = H(secret, nullifierKey, asset)
commitment = H(inner, amount)          // the Merkle-tree leaf
nullifier  = H(nullifierKey, leafIndex)
```

1. **Deposit (public)** — the user's wallet calls `deposit(commitment, asset, amount)`. This step is intentionally public; the anonymity set is all deposits.
2. **Spend (anonymous)** — the SDK proves in zero knowledge that the note is in the tree, the nullifier is correctly derived (no double-spend), amounts conserve (`amount = spendValue + fee + change`), and the exact intent (target, calldata, relayer, fee, return asset) is bound into the proof. The relayer submits `CloakPool.spend`, which verifies the proof and executes from an ephemeral CREATE2 proxy.
3. **Claim** — anything the forwarded call sends back is swept into a claim note whose secret only the original spender knows.

Because every execution detail is bound into the proof, the relayer is trusted **for liveness only** — it can decline to submit, but it can never redirect funds, change fees, or alter the call.

### Cryptographic integrity, verified end-to-end

- Poseidon2 is bit-identical across Noir, the Solidity pool (`poseidon2-evm`), and the SDK (`@aztec/bb.js`) — pinned to shared reference vectors in tests.
- An SDK-generated UltraHonk proof verifies on the generated on-chain verifier in the Foundry suite (`contracts/test/HonkVerifier.t.sol` is fed a real SDK proof).
- The full deposit → prove → relay → withdraw loop is exercised live against Sepolia (`sdk/scripts/live-smoke.mjs`, `sdk/examples/deposit-and-withdraw.mjs`).

## Deployments

### Ethereum Sepolia (chain id `11155111`)

| Component | Address / URL |
| --- | --- |
| `CloakPool` | [`0x8Aa022f478F42c7c0Da14B5D9Ae8EFD89FC47c97`](https://sepolia.etherscan.io/address/0x8Aa022f478F42c7c0Da14B5D9Ae8EFD89FC47c97) |
| `HonkVerifier` | [`0x87d1D1E6345A1d80DaA60B2B153d7F64d0BBfdd7`](https://sepolia.etherscan.io/address/0x87d1D1E6345A1d80DaA60B2B153d7F64d0BBfdd7) |
| Relayer | [`https://cloak-relayer.onrender.com`](https://cloak-relayer.onrender.com/info) (zero fee, sponsors gas on testnet) |

Deploy block `11207404`. The SDK ships these as `deployments.sepolia` — spread it straight into `createCloakClient`. Native ETH and ERC-20, arbitrary amounts. Ethereum mainnet and L2s are planned ([roadmap](#roadmap)).

## Repository layout

| Directory | What it is |
| --- | --- |
| [`circuits/`](circuits) | Noir `cloak_spend` circuit (UltraHonk) — note ownership, nullifier, amount conservation, intent binding |
| [`contracts/`](contracts) | Foundry contracts: `CloakPool` (pool + CREATE2 proxy factory + Poseidon2 Merkle tree), generated `HonkVerifier`, `CloakProxy` |
| [`relayer/`](relayer) | Rust (axum + alloy) relayer + gas sponsor; Render-deployable |
| [`sdk/`](sdk) | [`@privacy-protocol/cloak`](https://www.npmjs.com/package/@privacy-protocol/cloak) — viem core + wagmi React hooks, in-browser/Node proving |

Each component has its own README with deeper instructions.

## Development

### Toolchain

| Component | Requirements |
| --- | --- |
| Circuits | Noir (nargo) `1.0.0-beta.16`, bb `3.0.0-nightly.20251104` |
| Contracts | [Foundry](https://book.getfoundry.sh/getting-started/installation), Solidity `^0.8.21` |
| Relayer | Rust ≥ 1.85 |
| SDK | Node.js ≥ 18 |

> ⚠️ The Noir/bb pins are exact: proofs generated with other versions will not verify against the deployed verifier. UltraHonk needs no trusted setup — verifier generation is deterministic and reproducible from the circuit.

### Build & test

```bash
git clone https://github.com/Privacy-Protocol/cloak-sdk.git
cd cloak-sdk

# circuits → verifier + proof fixture (runs nargo test first)
cd circuits && ./scripts/build.sh

# contracts (16 tests, incl. real-proof on-chain verification)
cd ../contracts && forge test

# relayer
cd ../relayer && cargo build --release

# sdk (vitest: poseidon vectors + prove→verify e2e)
cd ../sdk && npm install && npm run build && npm test

# live checks against the Sepolia deployment
npm run smoke          # read-only: SDK tree root == on-chain root, relayer /info
npm run example:e2e    # full deposit→withdraw (needs SEPOLIA_RPC_URL + funded PRIVATE_KEY)
```

### Deploy your own stack

1. **Contracts** — set `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY` (see `contracts/.env.example`), then:
   ```bash
   cd contracts && forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
   ```
   The optimizer settings already in `foundry.toml` are required to fit the verifier under the 24 KB EIP-170 limit.
2. **Relayer** — see [`relayer/README.md`](relayer/README.md): set `RPC_URL`, `PRIVATE_KEY`, `POOL_ADDRESS`, `MIN_FEE`, fund the relayer key, `cargo run --release` (or deploy to Render via `render.yaml`).
3. **SDK** — point `createCloakClient` at your pool address + relayer URL (or add an entry to `sdk/src/deployments.ts`).

## Privacy properties & limitations

Honest notes — read these before building on Cloak:

- **Deposits are public** (asset, amount, depositor). Anonymity comes at spend time, from the size of the deposit set.
- **Amount & timing correlation** — distinctive amounts or deposit-then-immediately-spend patterns shrink your effective anonymity set. Prefer round amounts and delays.
- **Notes are the funds** — losing a note's `secret`/`nullifierKey` means unrecoverable funds. Use durable, encrypted storage in production.
- **Relayer trust is liveness-only** — it can censor, never steal (everything is bound in the proof). Anyone can run their own relayer.
- **Association sets / compliance proofs** are designed for but not enabled in v1.
- **Not audited.** The circuits and contracts have not undergone a formal third-party audit. **Do not use with mainnet funds.**

Found a vulnerability? Please report it privately via GitHub security advisories rather than a public issue.

## Roadmap

- **Association sets & compliance proofs** (Privacy Pools model) — prove your deposit is *not* from a flagged set without revealing which it is
- **Mainnet fee economics** — the fee mechanism is implemented and proof-bound; testnet runs at zero fee
- **Ethereum mainnet and L2 deployments** (post-audit)
- **Return-data claiming** and richer intent flows
- **Beacon integration** — the pool verifier sits behind an `IVerifier` seam for a future swap to the shared [Beacon](https://github.com/Privacy-Protocol/beacon) `VerifierHub`

## Contributing

Cloak is open source (MIT) and contributions are very welcome — this project is built to be a public good for the Ethereum ecosystem.

1. Fork the repo and create a feature branch
2. Make your change; keep the cross-layer invariants intact (circuit ⇄ contract ⇄ SDK tests must pass)
3. Open a pull request describing the motivation and approach — for protocol-affecting changes, open an issue first

Good first contributions: additional note-store backends, relayer hardening, docs and examples, gas/proving benchmarks.

## Community

- Website & docs: [privacyprotocol.org](https://www.privacyprotocol.org)
- X / Twitter: [@BuildOnPrivacy](https://x.com/BuildOnPrivacy)
- Telegram: [t.me/buildonprivacy](https://t.me/buildonprivacy)
- Discord: [discord.gg/aCmAGWaB](https://discord.gg/aCmAGWaB)

## License

[MIT](./LICENSE) © 2026 Privacy Protocol
