// Cloak unified spend circuit.
//
// One circuit covers every private movement out of the pool: forwarding a
// transaction through an ephemeral proxy, a plain withdrawal, and claiming
// returned funds -- they only differ in the cleartext execution params the
// pool hashes into `intent_hash`.
//
// Note model (all hashes Poseidon2 over BN254):
//   inner = H(secret, nullifier_key, asset)          -- pre-committable, amount-free
//   leaf  = H(inner, amount)                         -- what sits in the tree
// The two-level split lets the pool mint claim notes for amounts unknown at
// spend time: the spender pre-commits `claim_inner` (inside intent_hash) and
// the pool completes the leaf with whatever amount actually arrives.
//
//   nullifier_hash = H(nullifier_key, leaf_index)    -- index-bound, so equal
//                                                       leaves stay independently spendable
//
// Conservation: amount = spend_value + fee + change_amount, enforced by
// checked u128 arithmetic (underflow makes the witness unsatisfiable).
//
// `intent_hash` carries everything the circuit doesn't need to compute with
// (target, calldata hash, relayer, claim_inner, return asset, chain id, pool
// address). It is bound to the proof as a public input; the pool recomputes
// it on-chain from the submitted execution params.

use poseidon::poseidon2::Poseidon2;

global TREE_HEIGHT: u32 = 20;

fn hash_pair(left: Field, right: Field) -> Field {
    Poseidon2::hash([left, right], 2)
}

fn compute_inner(secret: Field, nullifier_key: Field, asset: Field) -> Field {
    Poseidon2::hash([secret, nullifier_key, asset], 3)
}

fn compute_leaf(inner: Field, amount: u128) -> Field {
    hash_pair(inner, amount as Field)
}

fn compute_nullifier(nullifier_key: Field, leaf_index: u32) -> Field {
    hash_pair(nullifier_key, leaf_index as Field)
}

fn compute_root(leaf: Field, leaf_index: u32, sibling_path: [Field; TREE_HEIGHT]) -> Field {
    let mut current_hash = leaf;
    let mut current_index = leaf_index;

    for level in 0..TREE_HEIGHT {
        let sibling = sibling_path[level];
        let is_right_child = current_index & 1 == 1;

        if is_right_child {
            current_hash = hash_pair(sibling, current_hash);
        } else {
            current_hash = hash_pair(current_hash, sibling);
        }

        current_index = current_index / 2;
    }

    current_hash
}

fn main(
    // -- public inputs (order must match CloakPool's verifier call) --
    root: pub Field,
    nullifier_hash: pub Field,
    asset: pub Field,
    spend_value: pub u128,
    fee: pub u128,
    change_commitment: pub Field,
    intent_hash: pub Field,
    // -- private witness --
    secret: Field,
    nullifier_key: Field,
    amount: u128,
    leaf_index: u32,
    sibling_path: [Field; TREE_HEIGHT],
    change_secret: Field,
    change_nullifier_key: Field,
) {
    let inner = compute_inner(secret, nullifier_key, asset);
    let leaf = compute_leaf(inner, amount);

    let computed_root = compute_root(leaf, leaf_index, sibling_path);
    assert(computed_root == root, "note is not in the tree");

    let expected_nullifier = compute_nullifier(nullifier_key, leaf_index);
    assert(nullifier_hash == expected_nullifier, "nullifier does not match the witness");

    // Checked u128 arithmetic: spend_value + fee > amount has no valid witness.
    let change_amount = amount - spend_value - fee;

    let change_inner = compute_inner(change_secret, change_nullifier_key, asset);
    let expected_change = compute_leaf(change_inner, change_amount);
    assert(change_commitment == expected_change, "change commitment does not match");

    // intent_hash needs no constraints: as a public input it is already bound
    // into the verification statement.
    let _ = intent_hash;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

struct TestNote {
    secret: Field,
    nullifier_key: Field,
    asset: Field,
    amount: u128,
    leaf_index: u32,
    sibling_path: [Field; TREE_HEIGHT],
}

fn test_note() -> TestNote {
    TestNote {
        secret: 12345,
        nullifier_key: 67890,
        asset: 0, // native ETH
        amount: 1_000_000_000_000_000_000, // 1 ether in wei
        leaf_index: 3,
        sibling_path: [7; TREE_HEIGHT],
    }
}

fn note_root(note: TestNote) -> Field {
    let inner = compute_inner(note.secret, note.nullifier_key, note.asset);
    let leaf = compute_leaf(inner, note.amount);
    compute_root(leaf, note.leaf_index, note.sibling_path)
}

fn change_leaf_for(note: TestNote, spend_value: u128, fee: u128) -> Field {
    let change_inner = compute_inner(1111, 2222, note.asset);
    compute_leaf(change_inner, note.amount - spend_value - fee)
}

#[test]
fn test_valid_partial_spend() {
    let note = test_note();
    let spend_value: u128 = 300_000_000_000_000_000;
    let fee: u128 = 1_000_000_000_000_000;

    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index),
        note.asset,
        spend_value,
        fee,
        change_leaf_for(note, spend_value, fee),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test]
fn test_valid_exact_spend_with_zero_change_and_fee() {
    let note = test_note();
    let spend_value = note.amount;

    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index),
        note.asset,
        spend_value,
        0,
        change_leaf_for(note, spend_value, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail)]
fn test_rejects_overspend() {
    let note = test_note();
    // spend_value + fee exceeds the note amount; change underflows.
    let spend_value = note.amount + 1;

    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index),
        note.asset,
        spend_value,
        0,
        change_leaf_for(note, 0, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail_with = "note is not in the tree")]
fn test_rejects_wrong_root() {
    let note = test_note();
    let spend_value: u128 = 100;

    main(
        note_root(note) + 1,
        compute_nullifier(note.nullifier_key, note.leaf_index),
        note.asset,
        spend_value,
        0,
        change_leaf_for(note, spend_value, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail_with = "nullifier does not match the witness")]
fn test_rejects_wrong_nullifier() {
    let note = test_note();
    let spend_value: u128 = 100;

    main(
        note_root(note),
        compute_nullifier(note.nullifier_key + 1, note.leaf_index),
        note.asset,
        spend_value,
        0,
        change_leaf_for(note, spend_value, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail_with = "nullifier does not match the witness")]
fn test_rejects_nullifier_for_other_leaf_index() {
    let note = test_note();
    let spend_value: u128 = 100;

    // Nullifier computed for a different index must not spend this leaf.
    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index + 1),
        note.asset,
        spend_value,
        0,
        change_leaf_for(note, spend_value, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail_with = "note is not in the tree")]
fn test_rejects_wrong_asset() {
    let note = test_note();
    let spend_value: u128 = 100;

    // Claiming the note is an ERC20 note changes `inner`, so the leaf no
    // longer matches the tree.
    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index),
        0x1234,
        spend_value,
        0,
        change_leaf_for(note, spend_value, 0),
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}

#[test(should_fail_with = "change commitment does not match")]
fn test_rejects_inflated_change() {
    let note = test_note();
    let spend_value: u128 = 100;
    let fee: u128 = 5;

    // Change leaf claims more than amount - spend - fee.
    let change_inner = compute_inner(1111, 2222, note.asset);
    let inflated_change = compute_leaf(change_inner, note.amount - spend_value);

    main(
        note_root(note),
        compute_nullifier(note.nullifier_key, note.leaf_index),
        note.asset,
        spend_value,
        fee,
        inflated_change,
        0xdeadbeef,
        note.secret,
        note.nullifier_key,
        note.amount,
        note.leaf_index,
        note.sibling_path,
        1111,
        2222,
    );
}
