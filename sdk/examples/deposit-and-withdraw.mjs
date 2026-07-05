// End-to-end example against the LIVE Sepolia deployment.
//
// Deposits a small amount of ETH, then privately withdraws it to a recipient
// via the relayer — exercising deposit -> prove -> relay -> spend on-chain.
//
// Requires a FUNDED Sepolia key (pays for the deposit + a little gas).
//   SEPOLIA_RPC_URL=... PRIVATE_KEY=0x... [RECIPIENT=0x...] \
//     [AMOUNT_ETH=0.002] node examples/deposit-and-withdraw.mjs
//
// Notes are the funds. This example persists them to ./.cloak-notes.json so a
// crash mid-flow never loses a deposit: re-running picks up the existing note
// and just retries the withdrawal. Delete that file to start fresh.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createCloakClient, deployments, ETH_ADDRESS } from "../dist/index.js";

const RPC = process.env.SEPOLIA_RPC_URL;
const PK = process.env.PRIVATE_KEY;
if (!RPC || !PK) throw new Error("set SEPOLIA_RPC_URL and PRIVATE_KEY");

const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const recipient = process.env.RECIPIENT ?? account.address;
const amount = parseEther(process.env.AMOUNT_ETH ?? "0.002");

const transport = http(RPC, { retryCount: 8, retryDelay: 1500, timeout: 30_000 });
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

// --- persistent, crash-safe note store (JSON file) ---
const FILE = new URL("../.cloak-notes.json", import.meta.url);
const reviver = (k, v) =>
  ["secret", "nullifierKey", "amount", "commitment"].includes(k) && typeof v === "string" ? BigInt(v) : v;
const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
const fileStore = {
  read: () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8"), reviver) : []),
  write: (notes) => writeFileSync(FILE, JSON.stringify(notes, replacer, 2)),
  async add(note) {
    const notes = this.read();
    notes.push(note);
    this.write(notes);
  },
  async update(commitment, patch) {
    this.write(this.read().map((n) => (n.commitment === commitment ? { ...n, ...patch } : n)));
  },
  async all() {
    return this.read();
  },
  async remove(commitment) {
    this.write(this.read().filter((n) => n.commitment !== commitment));
  },
};

// Lower this for rate-limited RPCs (Alchemy free tier caps eth_getLogs at 10).
const logChunkSize = process.env.LOG_CHUNK_SIZE ? BigInt(process.env.LOG_CHUNK_SIZE) : undefined;

const cloak = createCloakClient({
  ...deployments.sepolia,
  publicClient,
  walletClient,
  store: fileStore,
  ...(logChunkSize ? { logChunkSize } : {}),
});

console.log("depositor:", account.address);
console.log("recipient:", recipient);
console.log("amount:   ", formatEther(amount), "ETH\n");

// Use an existing unspent note if we have one (crash-resume); else deposit.
await cloak.sync();
let [note] = await cloak.getNotes();
if (note) {
  console.log("resuming with existing note, leafIndex:", note.leafIndex, "amount:", formatEther(note.amount));
} else {
  console.log("depositing…");
  note = await cloak.deposit({ asset: ETH_ADDRESS, amount });
  console.log("  deposited + persisted. note leafIndex:", note.leafIndex);
}

// Withdraw privately via the relayer (breaks the depositor -> recipient link).
console.log("\nproving + relaying withdrawal…");
const { txHash } = await cloak.withdraw({ note, to: recipient });
console.log("  relayer submitted tx:", txHash);

// Poll the relayer for status.
const base = deployments.sepolia.relayerUrl.replace(/\/$/, "");
for (let i = 0; i < 30; i++) {
  const res = await fetch(`${base}/status/${txHash}`);
  const s = await res.json();
  console.log("  status:", s.status, s.block_number ? `(block ${s.block_number})` : "");
  if (s.status === "success") {
    console.log("\n✅ done — withdrawal confirmed on-chain:");
    console.log(`   https://sepolia.etherscan.io/tx/${txHash}`);
    process.exit(0);
  }
  if (s.status === "failed") throw new Error("withdrawal reverted on-chain");
  await new Promise((r) => setTimeout(r, 5000));
}
console.log("\n⚠️ still pending after ~150s; check the tx hash on Sepolia Etherscan.");
