// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {HonkVerifier} from "../src/verifiers/HonkVerifier.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

/// @notice End-to-end zk pipeline check: a real UltraHonk (keccak) proof
/// produced by `bb prove` from the `cloak_spend` circuit must verify on-chain,
/// and any tampering with the public inputs must fail. Fixtures are regenerated
/// by circuits/scripts (see repo README).
contract HonkVerifierTest is Test {
    IVerifier verifier;
    bytes proof;
    bytes32[] publicInputs;

    function setUp() public {
        verifier = IVerifier(address(new HonkVerifier()));
        proof = vm.readFileBinary("test/fixtures/spend_proof.bin");
        bytes memory raw = vm.readFileBinary("test/fixtures/spend_public_inputs.bin");
        uint256 n = raw.length / 32;
        publicInputs = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 word;
            uint256 offset = 32 + i * 32; // skip bytes length slot
            assembly {
                word := mload(add(raw, offset))
            }
            publicInputs[i] = word;
        }
    }

    function test_realProofVerifies() public view {
        assertEq(publicInputs.length, 7, "expected 7 public inputs");
        assertTrue(verifier.verify(proof, publicInputs));
    }

    function test_tamperedPublicInputFails() public {
        publicInputs[1] = bytes32(uint256(publicInputs[1]) ^ 1); // flip a bit in the nullifier
        vm.expectRevert();
        verifier.verify(proof, publicInputs);
    }
}
