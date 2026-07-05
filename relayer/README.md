# Cloak Relayer

Trustless transaction relayer + gas sponsor for the Cloak privacy pool. It
submits `CloakPool.spend` transactions on behalf of users, so the on-chain
sender is the relayer, not the user — breaking the link between the depositor
and the destination. It cannot steal or redirect funds: the fee amount and the
fee recipient are bound into the zk proof, so a malicious relayer can only
choose to submit or not.

## Endpoints

| Method | Path          | Description                                             |
| ------ | ------------- | ------------------------------------------------------- |
| GET    | `/health`     | Liveness probe.                                         |
| GET    | `/info`       | Relayer address, pool address, chain id, min fee.       |
| POST   | `/relay`      | Submit a spend (forward / withdraw / claim-out).        |
| GET    | `/status/:id` | Status of a submitted tx (`id` is the tx hash).         |

### POST /relay

```json
{
  "proof": "0x…",
  "root": "0x…",
  "nullifierHash": "0x…",
  "changeCommitment": "0x…",
  "spendValue": "700000000000000000",
  "fee": "0",
  "intent": {
    "asset": "0x0000000000000000000000000000000000000000",
    "target": "0x…",
    "data": "0x",
    "relayer": "0x…",
    "claimInner": "0x…",
    "returnAsset": "0x0000000000000000000000000000000000000000"
  }
}
```

`intent.relayer` must equal this relayer's address (from `/info`), and `fee`
must be ≥ `MIN_FEE`. The relayer pre-checks the nullifier and root, then
submits; a would-be revert is surfaced as a `400`.

Response: `{ "id": "0x<txhash>", "txHash": "0x<txhash>", "status": "pending" }`.

## Configuration

See `.env.example`. Required: `RPC_URL`, `PRIVATE_KEY`, `POOL_ADDRESS`.

## Run locally

```bash
cp .env.example .env   # fill in values
cargo run
```

## Deploy to Render

`render.yaml` defines a Docker web service. Set `RPC_URL`, `PRIVATE_KEY`, and
`POOL_ADDRESS` as secrets in the Render dashboard. Fund the relayer address
with testnet ETH for gas.
