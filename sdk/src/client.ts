import {
  type PublicClient,
  type WalletClient,
  type Hex,
  type Address,
  parseEventLogs,
} from "viem";
import { cloakPoolAbi, erc20Abi } from "./abi";
import { ETH_ADDRESS } from "./constants";
import { type Note, createNote, computeInner, computeNullifier, assetField } from "./note";
import { MerkleTree } from "./tree";
import { type NoteStore, MemoryNoteStore } from "./store";
import { type Intent, computeIntentHash, toField32 } from "./intent";
import { proveSpend } from "./prover";
import { poseidon2 } from "./poseidon";

/** Flatten a (possibly nested) error's message/details/cause into one string. */
function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const o = cur as { message?: string; details?: string; shortMessage?: string; cause?: unknown };
    if (o.message) parts.push(o.message);
    if (o.details) parts.push(o.details);
    if (o.shortMessage) parts.push(o.shortMessage);
    cur = o.cause;
  }
  return parts.join(" ");
}

export interface CloakConfig {
  publicClient: PublicClient;
  /** Required for deposits (which the user signs) and reads. */
  walletClient?: WalletClient;
  poolAddress: Address;
  relayerUrl: string;
  chainId: number;
  /** Block the pool was deployed at, to bound log queries. */
  deployBlock?: bigint;
  /**
   * Max block span per `eth_getLogs` request during sync. Lower it for
   * rate-limited RPCs (e.g. Alchemy free tier caps at 10). Default 500.
   */
  logChunkSize?: bigint;
  /** Note persistence. Defaults to in-memory (lost on reload). */
  store?: NoteStore;
}

export interface RelayerInfo {
  relayerAddress: Address;
  poolAddress: Address;
  chainId: number;
  minFee: bigint;
}

export interface SendParams {
  note: Note;
  target: Address;
  /** Calldata; omit/empty for a plain transfer. */
  data?: Hex;
  /** Amount of the note's asset to spend (default: whole note minus fee). */
  value?: bigint;
  /** Asset expected back at the proxy (enables claiming). Default: none. */
  returnAsset?: Address;
  /** Relayer fee in the note's asset. Default 0. */
  fee?: bigint;
}

export interface SendResult {
  txHash: Hex;
  /** The change note (may be zero-valued); persisted automatically. */
  changeNote: Note;
  /** If returns were expected, the pending claim note to watch for. */
  claimNote?: Note;
}

export class CloakClient {
  readonly config: Required<Pick<CloakConfig, "publicClient" | "poolAddress" | "relayerUrl" | "chainId">> &
    CloakConfig;
  readonly store: NoteStore;
  private cachedInfo?: RelayerInfo;

  constructor(config: CloakConfig) {
    this.config = config;
    this.store = config.store ?? new MemoryNoteStore();
  }

  // --------------------------------------------------------------------- info

  async relayerInfo(): Promise<RelayerInfo> {
    if (this.cachedInfo) return this.cachedInfo;
    const res = await fetch(`${this.config.relayerUrl.replace(/\/$/, "")}/info`);
    if (!res.ok) throw new Error(`relayer /info failed: ${res.status}`);
    const j = (await res.json()) as {
      relayer_address: string;
      pool_address: string;
      chain_id: number;
      min_fee: string;
    };
    this.cachedInfo = {
      relayerAddress: j.relayer_address as Address,
      poolAddress: j.pool_address as Address,
      chainId: j.chain_id,
      minFee: BigInt(j.min_fee),
    };
    return this.cachedInfo;
  }

  // ------------------------------------------------------------------ deposit

  /**
   * Fund the pool with a new note. The user's wallet signs and pays for this
   * step (the deposit is public); privacy is established at spend time.
   */
  async deposit(params: { asset: Address; amount: bigint }): Promise<Note> {
    const wallet = this.requireWallet();
    const account = wallet.account;
    if (!account) throw new Error("walletClient has no account");

    const note = await createNote(params.asset, params.amount);
    const commitment = toField32(note.commitment!);

    if (params.asset !== ETH_ADDRESS) {
      await this.ensureAllowance(params.asset, account.address, params.amount);
    }

    const hash = await wallet.writeContract({
      account,
      chain: wallet.chain,
      address: this.config.poolAddress,
      abi: cloakPoolAbi,
      functionName: "deposit",
      args: [commitment, params.asset, params.amount],
      value: params.asset === ETH_ADDRESS ? params.amount : 0n,
    });

    const receipt = await this.config.publicClient.waitForTransactionReceipt({ hash });
    const logs = parseEventLogs({ abi: cloakPoolAbi, eventName: "Deposit", logs: receipt.logs });
    const mine = logs.find((l) => BigInt(l.args.commitment) === note.commitment);
    if (mine) note.leafIndex = Number(mine.args.leafIndex);

    note.kind = "deposit";
    await this.store.add(note);
    return note;
  }

  // -------------------------------------------------------------------- spend

  /**
   * Forward a transaction (or transfer) through an ephemeral proxy, consuming
   * `params.note`. Submitted via the relayer, so nothing links back to the
   * original depositor.
   */
  async send(params: SendParams): Promise<SendResult> {
    const { note } = params;
    if (note.leafIndex === undefined) {
      await this.sync();
      const refreshed = (await this.store.all()).find((n) => n.commitment === note.commitment);
      if (refreshed?.leafIndex !== undefined) note.leafIndex = refreshed.leafIndex;
    }
    if (note.leafIndex === undefined) throw new Error("note is not yet in the tree; sync first");

    const info = await this.relayerInfo();
    const fee = params.fee ?? 0n;
    const data: Hex = params.data ?? "0x";
    const spendValue = params.value ?? note.amount - fee;
    const changeAmount = note.amount - spendValue - fee;
    if (changeAmount < 0n) throw new Error("spendValue + fee exceeds note amount");

    const expectsReturns = params.returnAsset !== undefined && data !== "0x";
    const returnAsset = params.returnAsset ?? ETH_ADDRESS;

    // Change note (same asset), always inserted by the pool.
    const changeNote = await createNote(note.asset, changeAmount);

    // Claim note preimage (only meaningful when returns are expected).
    let claimNote: Note | undefined;
    let claimInner = 0n;
    if (expectsReturns) {
      claimNote = await createNote(returnAsset, 0n); // amount discovered on harvest
      claimNote.kind = "claim";
      claimInner = await computeInner(claimNote.secret, claimNote.nullifierKey, returnAsset);
      // Key the pending claim by its inner (unique) until the real leaf appears.
      claimNote.commitment = claimInner;
    }

    const intent: Intent = {
      asset: note.asset,
      target: params.target,
      data,
      relayer: info.relayerAddress,
      claimInner: toField32(claimInner),
      returnAsset,
    };
    const intentHash = computeIntentHash(this.config.chainId, this.config.poolAddress, intent);

    // Build the merkle proof for the note being spent. RPC log indexes can
    // lag the chain head right after a deposit, so briefly retry until the
    // note's leaf is visible.
    let tree = await this.sync();
    for (let i = 0; i < 5 && note.leafIndex >= tree.leafCount; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      tree = await this.sync();
    }
    const { siblings, root } = tree.proof(note.leafIndex);
    const nullifierHash = await computeNullifier(note.nullifierKey, note.leafIndex);

    const { proof } = await proveSpend({
      root,
      nullifierHash,
      asset: assetField(note.asset),
      spendValue,
      fee,
      changeCommitment: changeNote.commitment!,
      intentHash,
      secret: note.secret,
      nullifierKey: note.nullifierKey,
      amount: note.amount,
      leafIndex: note.leafIndex,
      siblingPath: siblings,
      changeSecret: changeNote.secret,
      changeNullifierKey: changeNote.nullifierKey,
    });

    const body = {
      proof,
      root: toField32(root),
      nullifierHash: toField32(nullifierHash),
      changeCommitment: toField32(changeNote.commitment!),
      spendValue: spendValue.toString(),
      fee: fee.toString(),
      intent: {
        asset: intent.asset,
        target: intent.target,
        data: intent.data,
        relayer: intent.relayer,
        claimInner: intent.claimInner,
        returnAsset: intent.returnAsset,
      },
    };

    const res = await fetch(`${this.config.relayerUrl.replace(/\/$/, "")}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`relay failed: ${res.status} ${errText}`);
    }
    // Relayer responds with snake_case { id, tx_hash, status }.
    const relayed = (await res.json()) as { tx_hash?: Hex; txHash?: Hex; id?: Hex };
    const txHash = (relayed.tx_hash ?? relayed.txHash ?? relayed.id) as Hex;

    // Update local note state.
    changeNote.kind = "change";
    if (note.commitment !== undefined) await this.store.update(note.commitment, { spent: true });
    if (changeAmount > 0n) await this.store.add(changeNote);
    if (claimNote) await this.store.add(claimNote);

    return { txHash, changeNote, claimNote };
  }

  /** Withdraw a note (or part of it) to any address, via the relayer. */
  async withdraw(params: { note: Note; to: Address; amount?: bigint; fee?: bigint }): Promise<SendResult> {
    return this.send({
      note: params.note,
      target: params.to,
      data: "0x",
      value: params.amount,
      fee: params.fee,
    });
  }

  /** Withdraw a discovered claim note to an address. */
  async claim(params: { claimNote: Note; to: Address; fee?: bigint }): Promise<SendResult> {
    if (params.claimNote.leafIndex === undefined) {
      throw new Error("claim note not yet harvested on-chain; sync and try again");
    }
    return this.withdraw({ note: params.claimNote, to: params.to, fee: params.fee });
  }

  // --------------------------------------------------------------------- sync

  /**
   * Rebuild the merkle tree from on-chain events and reconcile stored notes:
   * assign leaf indices to unsynced notes and discover harvested claim notes.
   */
  async sync(): Promise<MerkleTree> {
    const fromBlock = this.config.deployBlock ?? 0n;
    const toBlock = await this.config.publicClient.getBlockNumber();

    const [deposits, spents, claims] = await Promise.all([
      this._getEvents("Deposit", fromBlock, toBlock),
      this._getEvents("Spent", fromBlock, toBlock),
      this._getEvents("ClaimNoteCreated", fromBlock, toBlock),
    ]);

    const entries: { leafIndex: number; commitment: bigint }[] = [];
    for (const d of deposits) entries.push({ leafIndex: Number(d.args.leafIndex), commitment: BigInt(d.args.commitment!) });
    for (const s of spents)
      entries.push({ leafIndex: Number(s.args.changeLeafIndex), commitment: BigInt(s.args.changeCommitment!) });
    for (const c of claims)
      entries.push({ leafIndex: Number(c.args.leafIndex), commitment: BigInt(c.args.commitment!) });

    entries.sort((a, b) => a.leafIndex - b.leafIndex);
    const leaves = entries.map((e) => e.commitment);
    const commitmentToIndex = new Map(entries.map((e) => [e.commitment, e.leafIndex]));

    const tree = await MerkleTree.fromLeaves(leaves);

    // Reconcile stored notes.
    for (const n of await this.store.all()) {
      if (n.kind === "claim" && n.leafIndex === undefined) {
        // Match a harvested claim by recomputing H(inner, amount) per event.
        const inner = await computeInner(n.secret, n.nullifierKey, n.asset);
        for (const c of claims) {
          const amt = BigInt(c.args.amount!);
          const leaf = await poseidon2([inner, amt]);
          if (leaf === BigInt(c.args.commitment!)) {
            await this.store.update(n.commitment!, { amount: amt, leafIndex: Number(c.args.leafIndex) });
            break;
          }
        }
      } else if (n.leafIndex === undefined && n.commitment !== undefined) {
        const idx = commitmentToIndex.get(n.commitment);
        if (idx !== undefined) await this.store.update(n.commitment, { leafIndex: idx });
      }
    }

    return tree;
  }

  /** Spendable notes (synced, unspent, non-claim, positive value). */
  async getNotes(): Promise<Note[]> {
    return (await this.store.all()).filter(
      (n) => n.kind !== "claim" && !n.spent && n.leafIndex !== undefined && n.amount > 0n,
    );
  }

  /** Discovered, unspent claim notes ready to withdraw. */
  async getClaimables(): Promise<Note[]> {
    return (await this.store.all()).filter((n) => n.kind === "claim" && !n.spent && n.leafIndex !== undefined);
  }

  /**
   * Fetch a pool event across [fromBlock, toBlock], paging in `logChunkSize`
   * spans so rate-limited RPCs (which cap eth_getLogs block ranges) still work.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _getEvents(
    eventName: "Deposit" | "Spent" | "ClaimNoteCreated",
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<any[]> {
    const address = this.config.poolAddress;
    const pc = this.config.publicClient;
    const chunk = this.config.logChunkSize ?? 500n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let start = fromBlock; start <= toBlock; start += chunk) {
      const end = start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock;
      let events;
      try {
        events = await pc.getContractEvents({ address, abi: cloakPoolAbi, eventName, fromBlock: start, toBlock: end });
      } catch (e) {
        // Load-balanced RPCs can serve a node whose head lags the block number
        // we sampled, rejecting `toBlock` as "beyond head". Retry the chunk
        // against that node's own latest block. viem tucks the RPC detail into
        // nested error fields, so search the whole chain.
        if (/head|beyond/i.test(errorText(e))) {
          events = await pc.getContractEvents({ address, abi: cloakPoolAbi, eventName, fromBlock: start, toBlock: "latest" });
        } else {
          throw e;
        }
      }
      all.push(...events);
    }
    return all;
  }

  // ------------------------------------------------------------------ helpers

  private requireWallet(): WalletClient {
    if (!this.config.walletClient) throw new Error("walletClient is required for this operation");
    return this.config.walletClient;
  }

  private async ensureAllowance(token: Address, owner: Address, amount: bigint): Promise<void> {
    const current = (await this.config.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, this.config.poolAddress],
    })) as bigint;
    if (current >= amount) return;
    const wallet = this.requireWallet();
    const hash = await wallet.writeContract({
      account: wallet.account!,
      chain: wallet.chain,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [this.config.poolAddress, amount],
    });
    await this.config.publicClient.waitForTransactionReceipt({ hash });
  }
}

export function createCloakClient(config: CloakConfig): CloakClient {
  if (config.chainId === undefined) throw new Error("chainId is required");
  return new CloakClient(config);
}
