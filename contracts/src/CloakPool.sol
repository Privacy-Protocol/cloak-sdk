// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Poseidon2MerkleTree} from "./Poseidon2MerkleTree.sol";
import {CloakProxy} from "./CloakProxy.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title CloakPool
/// @notice The privacy-pool core: a shared anonymity set for arbitrary-amount
/// deposits, and a zk-gated spend path that forwards transactions through
/// per-spend ephemeral proxies, breaking the link between depositor and
/// destination. Also acts as the CREATE2 factory for its proxies.
///
/// Note model (Poseidon2 over BN254, mirrored in the circuit and SDK):
///   inner = H(secret, nullifierKey, asset)
///   leaf  = H(inner, amount)                 <- stored in the tree
///   nullifier = H(nullifierKey, leafIndex)
///
/// Deposits are public (asset + amount + depositor are visible); privacy comes
/// from the shared set plus the relayer submitting the later spend. A single
/// spend circuit covers forwarding, withdrawal, and claiming returned funds --
/// they differ only in the cleartext execution params bound into `intentHash`.
contract CloakPool is Poseidon2MerkleTree {
    // --- errors ---
    error ZeroAmount();
    error UnexpectedValue();
    error UnknownRoot();
    error NullifierAlreadyUsed();
    error InvalidProof();
    error ProxyMismatch();
    error TransferFailed();
    error Reentrancy();
    error UnknownSpend();

    // --- events (carry leafIndex so the SDK can rebuild the tree in order) ---
    event Deposit(bytes32 indexed commitment, uint32 leafIndex, address asset, uint256 amount, uint256 timestamp);
    event Spent(
        bytes32 indexed nullifierHash,
        bytes32 changeCommitment,
        uint32 changeLeafIndex,
        bytes32 intentHash,
        address proxy,
        bytes returnData
    );
    event ClaimNoteCreated(
        bytes32 indexed nullifierHash, bytes32 commitment, uint32 leafIndex, address returnAsset, uint256 amount
    );

    struct SpendProof {
        bytes proof;
        bytes32 root;
        bytes32 nullifierHash;
        bytes32 changeCommitment;
        uint256 spendValue;
        uint256 fee;
    }

    /// @dev Cleartext execution intent. Everything here except `asset` is bound
    /// into `intentHash`; `asset` is bound as its own public input.
    struct Intent {
        address asset; // address(0) == native ETH
        address target;
        bytes data; // empty => transfer, non-empty => contract call
        address relayer; // fee recipient
        bytes32 claimInner; // pre-committed inner of the claim note for returns
        address returnAsset; // asset expected back at the proxy
    }

    struct SpendInfo {
        bytes32 claimInner;
        address returnAsset;
        address proxy;
        bool exists;
    }

    IVerifier public immutable verifier;

    mapping(bytes32 => bool) public nullifierUsed;
    mapping(bytes32 => SpendInfo) public spends; // nullifierHash => info (for later harvests)

    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IVerifier _verifier) {
        verifier = _verifier;
    }

    // -----------------------------------------------------------------------
    // Deposit
    // -----------------------------------------------------------------------

    /// @notice Fund the pool and insert a note commitment.
    /// @param commitment leaf = H(H(secret, nullifierKey, assetField), amount).
    /// @param asset address(0) for ETH, else the ERC20 token address.
    /// @param amount Amount deposited; must equal msg.value for ETH.
    function deposit(bytes32 commitment, address asset, uint256 amount) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (asset == address(0)) {
            if (msg.value != amount) revert UnexpectedValue();
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            _pullToken(asset, msg.sender, amount);
        }
        uint32 index = _insert(commitment);
        emit Deposit(commitment, index, asset, amount, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Spend (forward / withdraw / claim-out)
    // -----------------------------------------------------------------------

    /// @notice Consume a note and execute the bound intent through an ephemeral
    /// proxy. Relayer-submittable; the fee goes to the `relayer` bound in the
    /// proof, so whoever lands the tx cannot redirect or inflate it.
    function spend(SpendProof calldata sp, Intent calldata intent) external nonReentrant returns (bytes memory returnData) {
        if (nullifierUsed[sp.nullifierHash]) revert NullifierAlreadyUsed();
        if (!isKnownRoot(sp.root)) revert UnknownRoot();

        bytes32 boundIntent = _intentHash(intent);

        bytes32[] memory publicInputs = new bytes32[](7);
        publicInputs[0] = sp.root;
        publicInputs[1] = sp.nullifierHash;
        publicInputs[2] = bytes32(uint256(uint160(intent.asset)));
        publicInputs[3] = bytes32(sp.spendValue);
        publicInputs[4] = bytes32(sp.fee);
        publicInputs[5] = sp.changeCommitment;
        publicInputs[6] = boundIntent;

        if (!verifier.verify(sp.proof, publicInputs)) revert InvalidProof();

        // Effects before interactions.
        nullifierUsed[sp.nullifierHash] = true;
        uint32 changeIndex = _insert(sp.changeCommitment);

        // Pay the relayer from the consumed note (same asset as the note).
        if (sp.fee > 0) _payOut(intent.asset, intent.relayer, sp.fee);

        // Deploy (or reuse) the per-spend proxy and fund it.
        address proxy = _deployProxy(sp.nullifierHash);
        if (sp.spendValue > 0) _fundProxy(intent.asset, proxy, sp.spendValue);

        returnData = CloakProxy(payable(proxy)).execute(intent.asset, intent.target, sp.spendValue, intent.data);

        spends[sp.nullifierHash] =
            SpendInfo({claimInner: intent.claimInner, returnAsset: intent.returnAsset, proxy: proxy, exists: true});

        emit Spent(sp.nullifierHash, sp.changeCommitment, changeIndex, boundIntent, proxy, returnData);

        // Sweep any funds that came back during execution into a claim note.
        _harvest(sp.nullifierHash);
    }

    /// @notice Permissionlessly sweep funds that later arrived at a spend's
    /// proxy (e.g. asynchronous protocol payouts) into a fresh claim note.
    function harvest(bytes32 nullifierHash) external nonReentrant {
        if (!spends[nullifierHash].exists) revert UnknownSpend();
        _harvest(nullifierHash);
    }

    function _harvest(bytes32 nullifierHash) internal {
        SpendInfo memory info = spends[nullifierHash];
        uint256 amount = CloakProxy(payable(info.proxy)).sweep(info.returnAsset);
        if (amount == 0) return;
        bytes32 commitment = hash2(info.claimInner, bytes32(amount));
        uint32 index = _insert(commitment);
        emit ClaimNoteCreated(nullifierHash, commitment, index, info.returnAsset, amount);
    }

    // -----------------------------------------------------------------------
    // Intent hashing / proxy address (also used by the SDK/relayer off-chain)
    // -----------------------------------------------------------------------

    /// @notice Recompute the intent hash the prover committed to. Domain-
    /// separated by chain id and pool address so a proof can't be replayed on
    /// another chain or pool. Reduced mod the BN254 field to be a valid input.
    function intentHash(Intent calldata intent) external view returns (bytes32) {
        return _intentHash(intent);
    }

    function _intentHash(Intent calldata intent) internal view returns (bytes32) {
        uint256 h = uint256(
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    intent.target,
                    keccak256(intent.data),
                    intent.relayer,
                    intent.claimInner,
                    intent.returnAsset
                )
            )
        ) % FIELD_PRIME;
        return bytes32(h);
    }

    /// @notice The deterministic proxy address for a given spend (salt =
    /// nullifierHash), whether or not it has been deployed yet.
    function proxyAddress(bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(CloakProxy).creationCode))
        );
        return address(uint160(uint256(h)));
    }

    // -----------------------------------------------------------------------
    // internals
    // -----------------------------------------------------------------------

    function _deployProxy(bytes32 salt) internal returns (address proxy) {
        proxy = proxyAddress(salt);
        if (proxy.code.length == 0) {
            CloakProxy deployed = new CloakProxy{salt: salt}();
            if (address(deployed) != proxy) revert ProxyMismatch();
        }
    }

    function _fundProxy(address asset, address proxy, uint256 amount) internal {
        if (asset == address(0)) {
            (bool ok,) = proxy.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _sendToken(asset, proxy, amount);
        }
    }

    function _payOut(address asset, address to, uint256 amount) internal {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _sendToken(asset, to, amount);
        }
    }

    // --- minimal SafeERC20 ---

    function _pullToken(address token, address from, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _sendToken(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    receive() external payable {}
}
