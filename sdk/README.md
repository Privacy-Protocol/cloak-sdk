# @privacy-protocol/cloak

Anonymous transactions for any dapp. Cloak is a privacy-pools layer: deposit
funds under a commitment, then forward transactions, withdraw, or claim returned
funds through zero-knowledge proofs and a relayer — so the on-chain trail never
links back to you. No contracts to write, nothing to deploy; the SDK talks to
the already-deployed Cloak pool and relayer.

```bash
npm install @privacy-protocol/cloak viem
# for React:
npm install @privacy-protocol/cloak viem wagmi @tanstack/react-query
```

## Core (TypeScript / Node / any framework)

```ts
import { createCloakClient, LocalStorageNoteStore, deployments } from "@privacy-protocol/cloak";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { sepolia } from "viem/chains";

const { poolAddress, deployBlock } = deployments.sepolia;

const publicClient = createPublicClient({ chain: sepolia, transport: http() });
const walletClient = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });

const cloak = createCloakClient({
  publicClient,
  walletClient,
  chainId: sepolia.id,
  poolAddress,
  deployBlock,
  relayerUrl: "https://cloak-relayer.onrender.com",
  store: new LocalStorageNoteStore(sepolia.id, poolAddress),
});

// 1. Deposit (public — the user signs and pays).
const note = await cloak.deposit({ asset: "0x0000000000000000000000000000000000000000", amount: 10n ** 17n });

// 2. Later, forward a transaction anonymously through the relayer.
await cloak.send({ note, target: "0xApp...", data: "0x...", value: 5n * 10n ** 16n, returnAsset: "0x0000000000000000000000000000000000000000" });

// or simply withdraw to a fresh address
await cloak.withdraw({ note, to: "0xFresh..." });

// 3. Claim funds that came back to the ephemeral proxy.
await cloak.sync();
for (const c of await cloak.getClaimables()) {
  await cloak.claim({ claimNote: c, to: "0xFresh..." });
}
```

## React (wagmi)

```tsx
import { CloakProvider, useDeposit, useCloakSend, useNotes, useClaimables } from "@privacy-protocol/cloak/react";

function App() {
  return (
    <CloakProvider poolAddress={deployments.sepolia.poolAddress} relayerUrl="https://cloak-relayer.onrender.com">
      <Wallet />
    </CloakProvider>
  );
}

function Wallet() {
  const deposit = useDeposit();
  const send = useCloakSend();
  const { data: notes } = useNotes();
  const { data: claimables } = useClaimables();
  // deposit.mutate({ asset, amount }); send.mutate({ note, target, value }); ...
}
```

`CloakProvider` must sit inside `WagmiProvider` and `QueryClientProvider`.

## How it works

- **Deposit** puts funds in a shared pool under `commitment = H(H(secret, nullifierKey, asset), amount)`.
- **Send/withdraw** proves, in zero knowledge, that you own an unspent note in the tree, binds the exact intent (target, calldata, value, fee, relayer) into the proof, and the relayer submits it — so the executing address is an ephemeral proxy, not you.
- **Change** returns to the pool as a fresh note; **returned funds** land at the proxy and become a claim note you alone can withdraw.
- The relayer sponsors gas and cannot redirect or inflate the fee (both are bound in the proof).

## Privacy notes

- Deposits are public (asset, amount, and your address are visible on-chain). Anonymity comes from the shared set + relayer at spend time, so deposit early and let the set grow.
- Arbitrary amounts are supported, but a distinctive deposit amount followed by a distinctive spend can be correlated. Prefer round amounts and add delay between deposit and spend.
- **Your notes are your funds.** Persist the `NoteStore` durably and privately; losing a note's `secret`/`nullifierKey` means the funds are unrecoverable.

## API

`createCloakClient(config)` → `CloakClient` with `deposit`, `send`, `withdraw`,
`claim`, `sync`, `getNotes`, `getClaimables`, `relayerInfo`. Lower-level helpers
(`proveSpend`, `MerkleTree`, `poseidon2`, `computeIntentHash`, `cloakPoolAbi`)
are exported for advanced use.
