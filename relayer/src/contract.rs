use alloy::sol;

// ABI binding for CloakPool. Structs must match contracts/src/CloakPool.sol.
sol! {
    #[sol(rpc)]
    contract CloakPool {
        struct SpendProof {
            bytes proof;
            bytes32 root;
            bytes32 nullifierHash;
            bytes32 changeCommitment;
            uint256 spendValue;
            uint256 fee;
        }

        struct Intent {
            address asset;
            address target;
            bytes data;
            address relayer;
            bytes32 claimInner;
            address returnAsset;
        }

        function spend(SpendProof sp, Intent intent) external returns (bytes returnData);
        function intentHash(Intent intent) external view returns (bytes32);
        function nullifierUsed(bytes32 nullifier) external view returns (bool);
        function isKnownRoot(bytes32 root) external view returns (bool);
    }
}
