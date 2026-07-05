// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title IVerifier
/// @notice Seam over the zk proof verifier. The generated `HonkVerifier`
/// implements this today; swapping to Beacon's `VerifierHub` later is a
/// one-line change in the pool's constructor.
interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
