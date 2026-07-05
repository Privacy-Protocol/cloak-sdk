// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {LibPoseidon2Yul} from "poseidon2-evm/bn254/yul/LibPoseidon2Yul.sol";

/// @notice Pins the Solidity Poseidon2 implementation to the exact outputs
/// produced by Noir's `poseidon` crate (v0.2.6). If these drift, on-chain
/// roots/commitments/nullifiers stop matching client-side proofs.
contract Poseidon2CompatTest is Test {
    function test_hash2_matches_noir() public pure {
        assertEq(
            LibPoseidon2Yul.hash_2(1, 2),
            0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383
        );
    }

    function test_hash3_matches_noir() public pure {
        assertEq(
            LibPoseidon2Yul.hash_3(12345, 67890, 0),
            0x1cab44acc2f05990337d4facca22069ce7f4614f9ed3f81cd3a7e122f4beae79
        );
    }

    function test_hash2_large_matches_noir() public pure {
        assertEq(
            LibPoseidon2Yul.hash_2(0xabcdef, 1000000000000000000),
            0x1fae2081c6e18fadeb5f37ede90ea8439027421d675ff16a58c42a8efebeff15
        );
    }
}
