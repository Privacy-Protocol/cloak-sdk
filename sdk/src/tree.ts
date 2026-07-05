import { TREE_HEIGHT, ZERO_VALUE } from "./constants";
import { poseidon2 } from "./poseidon";

/**
 * Off-chain mirror of the on-chain incremental Merkle tree. Rebuilt from the
 * ordered list of inserted leaves (deposits, change notes and claim notes, all
 * carrying their leafIndex in events), it reproduces the same roots and lets us
 * derive the sibling path a proof needs.
 */
export class MerkleTree {
  private zeros: bigint[] = [];
  /** leaves[level][index] — only the populated nodes are stored. */
  private layers: Map<number, bigint>[] = [];
  private _leafCount = 0;

  private constructor() {
    for (let i = 0; i <= TREE_HEIGHT; i++) this.layers.push(new Map());
  }

  /** Build a tree from leaves given in insertion order (index == position). */
  static async fromLeaves(leaves: bigint[]): Promise<MerkleTree> {
    const tree = new MerkleTree();
    await tree.initZeros();
    for (let i = 0; i < leaves.length; i++) {
      await tree.insert(leaves[i]!);
    }
    return tree;
  }

  private async initZeros(): Promise<void> {
    let current = ZERO_VALUE;
    this.zeros = [current];
    for (let i = 0; i < TREE_HEIGHT; i++) {
      current = await poseidon2([current, current]);
      this.zeros.push(current);
    }
  }

  private zeroAt(level: number): bigint {
    return this.zeros[level]!;
  }

  get leafCount(): number {
    return this._leafCount;
  }

  private async insert(leaf: bigint): Promise<void> {
    const index = this._leafCount;
    this.layers[0]!.set(index, leaf);

    let currentIndex = index;
    let currentHash = leaf;
    for (let level = 0; level < TREE_HEIGHT; level++) {
      let left: bigint;
      let right: bigint;
      if (currentIndex % 2 === 0) {
        left = currentHash;
        right = this.getNode(level, currentIndex + 1);
      } else {
        left = this.getNode(level, currentIndex - 1);
        right = currentHash;
      }
      currentHash = await poseidon2([left, right]);
      currentIndex = Math.floor(currentIndex / 2);
      this.layers[level + 1]!.set(currentIndex, currentHash);
    }
    this._leafCount = index + 1;
  }

  private getNode(level: number, index: number): bigint {
    const v = this.layers[level]!.get(index);
    return v !== undefined ? v : this.zeroAt(level);
  }

  /** Current root. */
  root(): bigint {
    if (this._leafCount === 0) return this.zeroAt(TREE_HEIGHT);
    return this.getNode(TREE_HEIGHT, 0);
  }

  /** The sibling path for `leafIndex`, from leaf level up to the root. */
  proof(leafIndex: number): { siblings: bigint[]; root: bigint } {
    if (leafIndex >= this._leafCount) throw new Error(`leaf ${leafIndex} not in tree`);
    const siblings: bigint[] = [];
    let currentIndex = leafIndex;
    for (let level = 0; level < TREE_HEIGHT; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      siblings.push(this.getNode(level, siblingIndex));
      currentIndex = Math.floor(currentIndex / 2);
    }
    return { siblings, root: this.root() };
  }
}
