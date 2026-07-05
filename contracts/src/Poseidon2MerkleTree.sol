// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {LibPoseidon2Yul} from "poseidon2-evm/bn254/yul/LibPoseidon2Yul.sol";

/// @title Poseidon2MerkleTree
/// @notice Fixed-depth incremental Merkle tree over BN254 Poseidon2, matching
/// the tree the Noir `cloak_spend` circuit reconstructs. Depth and hash must
/// stay in lockstep with the circuit (`TREE_HEIGHT = 20`) and the SDK's
/// off-chain tree, or client proofs stop verifying.
///
/// Tornado-style: `filledSubtrees` caches the left-fringe so each insert is
/// O(depth), and a ring buffer of recent roots lets proofs reference a slightly
/// stale root (deposits between proof-build and submission don't invalidate it).
abstract contract Poseidon2MerkleTree {
    uint256 internal constant FIELD_PRIME =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint32 public constant LEVELS = 20;
    uint32 internal constant ROOT_HISTORY_SIZE = 64;

    /// @dev Empty-leaf value; nothing-up-my-sleeve so it can't be a real note
    /// (real leaves are Poseidon2 outputs). Mirrored by the SDK.
    bytes32 public constant ZERO_VALUE =
        bytes32(uint256(keccak256("cloak.empty.leaf.v1")) % FIELD_PRIME);

    bytes32[LEVELS] internal filledSubtrees;
    bytes32[LEVELS] internal zeros;

    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex;
    uint32 public nextLeafIndex;

    constructor() {
        bytes32 current = ZERO_VALUE;
        for (uint32 i = 0; i < LEVELS; i++) {
            zeros[i] = current;
            filledSubtrees[i] = current;
            current = _hash(current, current);
        }
        roots[0] = current; // root of an all-empty tree
    }

    function hash2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return _hash(a, b);
    }

    function _hash(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return bytes32(LibPoseidon2Yul.hash_2(uint256(a), uint256(b)));
    }

    /// @notice Insert a leaf, returning its index. Updates the current root.
    function _insert(bytes32 leaf) internal returns (uint32 index) {
        index = nextLeafIndex;
        require(index < uint32(1) << LEVELS, "tree is full");

        uint32 currentIndex = index;
        bytes32 currentHash = leaf;

        for (uint32 i = 0; i < LEVELS; i++) {
            bytes32 left;
            bytes32 right;
            if (currentIndex & 1 == 0) {
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = _hash(left, right);
            currentIndex >>= 1;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentHash;
        nextLeafIndex = index + 1;
    }

    /// @notice True if `root` is one of the last ROOT_HISTORY_SIZE roots.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        uint32 i = currentRootIndex;
        for (uint32 seen = 0; seen < ROOT_HISTORY_SIZE; seen++) {
            if (roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        }
        return false;
    }

    function currentRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }
}
