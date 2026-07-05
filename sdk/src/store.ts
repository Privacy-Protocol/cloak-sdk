import type { Note } from "./note";

/**
 * Where notes are persisted between sessions. Notes ARE the funds — the app is
 * responsible for durable, private storage. In-memory and localStorage
 * implementations are provided; back this with encrypted storage in production.
 */
export interface NoteStore {
  add(note: Note): Promise<void>;
  update(commitment: bigint, patch: Partial<Note>): Promise<void>;
  all(): Promise<Note[]>;
  remove(commitment: bigint): Promise<void>;
}

interface SerializedNote {
  secret: string;
  nullifierKey: string;
  asset: `0x${string}`;
  amount: string;
  leafIndex?: number;
  commitment?: string;
}

function serialize(n: Note): SerializedNote {
  return {
    secret: n.secret.toString(),
    nullifierKey: n.nullifierKey.toString(),
    asset: n.asset,
    amount: n.amount.toString(),
    leafIndex: n.leafIndex,
    commitment: n.commitment?.toString(),
  };
}

function deserialize(s: SerializedNote): Note {
  return {
    secret: BigInt(s.secret),
    nullifierKey: BigInt(s.nullifierKey),
    asset: s.asset,
    amount: BigInt(s.amount),
    leafIndex: s.leafIndex,
    commitment: s.commitment !== undefined ? BigInt(s.commitment) : undefined,
  };
}

export class MemoryNoteStore implements NoteStore {
  private notes = new Map<string, Note>();

  private key(note: Note): string {
    if (note.commitment === undefined) throw new Error("note has no commitment");
    return note.commitment.toString();
  }

  async add(note: Note): Promise<void> {
    this.notes.set(this.key(note), { ...note });
  }
  async update(commitment: bigint, patch: Partial<Note>): Promise<void> {
    const existing = this.notes.get(commitment.toString());
    if (existing) this.notes.set(commitment.toString(), { ...existing, ...patch });
  }
  async all(): Promise<Note[]> {
    return [...this.notes.values()].map((n) => ({ ...n }));
  }
  async remove(commitment: bigint): Promise<void> {
    this.notes.delete(commitment.toString());
  }
}

/** localStorage-backed store, keyed per chain + pool. Browser only. */
export class LocalStorageNoteStore implements NoteStore {
  private storageKey: string;

  constructor(chainId: number, pool: string) {
    if (typeof localStorage === "undefined") throw new Error("localStorage unavailable");
    this.storageKey = `cloak.notes.${chainId}.${pool.toLowerCase()}`;
  }

  private read(): SerializedNote[] {
    const raw = localStorage.getItem(this.storageKey);
    return raw ? (JSON.parse(raw) as SerializedNote[]) : [];
  }
  private write(notes: SerializedNote[]): void {
    localStorage.setItem(this.storageKey, JSON.stringify(notes));
  }

  async add(note: Note): Promise<void> {
    const notes = this.read();
    notes.push(serialize(note));
    this.write(notes);
  }
  async update(commitment: bigint, patch: Partial<Note>): Promise<void> {
    const notes = this.read().map((s) => {
      if (s.commitment === commitment.toString()) {
        const merged = { ...deserialize(s), ...patch };
        return serialize(merged);
      }
      return s;
    });
    this.write(notes);
  }
  async all(): Promise<Note[]> {
    return this.read().map(deserialize);
  }
  async remove(commitment: bigint): Promise<void> {
    this.write(this.read().filter((s) => s.commitment !== commitment.toString()));
  }
}
