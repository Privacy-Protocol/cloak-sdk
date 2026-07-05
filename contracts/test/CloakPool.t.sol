// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {CloakPool} from "../src/CloakPool.sol";
import {CloakProxy} from "../src/CloakProxy.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {LibPoseidon2Yul} from "poseidon2-evm/bn254/yul/LibPoseidon2Yul.sol";
import {MockVerifier, MockERC20, EchoTarget} from "./mocks/Mocks.sol";

/// @notice Pool logic in isolation (proof verification stubbed). Covers the
/// deposit -> spend -> harvest lifecycle, replay/root guards, and the ephemeral
/// proxy mechanics.
contract CloakPoolTest is Test {
    CloakPool pool;
    MockVerifier verifier;
    MockERC20 token;

    address relayer = address(0xBEEF);
    address recipient = address(0xCAFE);

    function setUp() public {
        verifier = new MockVerifier();
        pool = new CloakPool(IVerifier(address(verifier)));
        token = new MockERC20();
        vm.deal(address(this), 100 ether);
    }

    function _hash2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return bytes32(LibPoseidon2Yul.hash_2(uint256(a), uint256(b)));
    }

    function _commitment(uint256 secret, uint256 nk, address asset, uint256 amount) internal pure returns (bytes32) {
        uint256 inner = LibPoseidon2Yul.hash_3(secret, nk, uint256(uint160(asset)));
        return bytes32(LibPoseidon2Yul.hash_2(inner, amount));
    }

    // --- deposit ---

    function test_depositEthInsertsLeaf() public {
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        vm.expectEmit(true, false, false, true);
        emit CloakPool.Deposit(c, 0, address(0), 1 ether, block.timestamp);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        assertEq(address(pool).balance, 1 ether);
        assertEq(pool.nextLeafIndex(), 1);
        assertTrue(pool.isKnownRoot(pool.currentRoot()));
    }

    function test_depositEthWrongValueReverts() public {
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        vm.expectRevert(CloakPool.UnexpectedValue.selector);
        pool.deposit{value: 0.5 ether}(c, address(0), 1 ether);
    }

    function test_depositErc20() public {
        token.mint(address(this), 5 ether);
        token.approve(address(pool), 5 ether);
        bytes32 c = _commitment(1, 2, address(token), 5 ether);
        pool.deposit(c, address(token), 5 ether);
        assertEq(token.balanceOf(address(pool)), 5 ether);
        assertEq(pool.nextLeafIndex(), 1);
    }

    // --- spend: ETH withdrawal ---

    function _ethWithdrawIntent() internal view returns (CloakPool.Intent memory) {
        return CloakPool.Intent({
            asset: address(0),
            target: recipient,
            data: "",
            relayer: relayer,
            claimInner: bytes32(0),
            returnAsset: address(0)
        });
    }

    function test_spendEthWithdrawal() public {
        // Fund the pool with a note worth 1 ETH.
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        CloakPool.Intent memory intent = _ethWithdrawIntent();
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: bytes32(uint256(0x1111)),
            changeCommitment: _commitment(9, 9, address(0), 0.29 ether),
            spendValue: 0.7 ether,
            fee: 0.01 ether
        });

        vm.prank(relayer);
        pool.spend(sp, intent);

        assertEq(recipient.balance, 0.7 ether, "recipient paid");
        assertEq(relayer.balance, 0.01 ether, "relayer fee");
        assertTrue(pool.nullifierUsed(sp.nullifierHash));
        // deposit leaf (0) + change note (1)
        assertEq(pool.nextLeafIndex(), 2);
    }

    function test_spendReplayReverts() public {
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        CloakPool.Intent memory intent = _ethWithdrawIntent();
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: bytes32(uint256(0x1111)),
            changeCommitment: _commitment(9, 9, address(0), 0.29 ether),
            spendValue: 0.7 ether,
            fee: 0.01 ether
        });
        pool.spend(sp, intent);

        // reuse same nullifier
        sp.root = pool.currentRoot();
        vm.expectRevert(CloakPool.NullifierAlreadyUsed.selector);
        pool.spend(sp, intent);
    }

    function test_spendUnknownRootReverts() public {
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        CloakPool.Intent memory intent = _ethWithdrawIntent();
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: bytes32(uint256(0xdead)),
            nullifierHash: bytes32(uint256(0x1111)),
            changeCommitment: _commitment(9, 9, address(0), 0.29 ether),
            spendValue: 0.7 ether,
            fee: 0.01 ether
        });
        vm.expectRevert(CloakPool.UnknownRoot.selector);
        pool.spend(sp, intent);
    }

    function test_spendInvalidProofReverts() public {
        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);
        verifier.setResult(false);

        CloakPool.Intent memory intent = _ethWithdrawIntent();
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: bytes32(uint256(0x1111)),
            changeCommitment: _commitment(9, 9, address(0), 0.29 ether),
            spendValue: 0.7 ether,
            fee: 0
        });
        vm.expectRevert(CloakPool.InvalidProof.selector);
        pool.spend(sp, intent);
    }

    // --- spend: ETH contract call with returned funds -> harvest ---

    function test_spendContractCallHarvestsReturns() public {
        EchoTarget echo = new EchoTarget();

        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        bytes32 claimInner = bytes32(LibPoseidon2Yul.hash_3(77, 88, uint256(uint160(address(0)))));
        CloakPool.Intent memory intent = CloakPool.Intent({
            asset: address(0),
            target: address(echo),
            data: abi.encodeWithSignature("ping()"),
            relayer: relayer,
            claimInner: claimInner,
            returnAsset: address(0)
        });
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: bytes32(uint256(0x2222)),
            changeCommitment: _commitment(9, 9, address(0), 0.4 ether),
            spendValue: 0.6 ether,
            fee: 0
        });

        pool.spend(sp, intent);

        // Echo returns half of 0.6 = 0.3 ETH to the proxy, harvested into a claim note.
        bytes32 expectedClaim = _hash2(claimInner, bytes32(uint256(0.3 ether)));
        // leaves: deposit(0), change(1), claim(2)
        assertEq(pool.nextLeafIndex(), 3);

        (bytes32 storedInner, address returnAsset, address proxy, bool exists) = pool.spends(sp.nullifierHash);
        assertEq(storedInner, claimInner);
        assertEq(returnAsset, address(0));
        assertTrue(exists);
        assertEq(proxy, pool.proxyAddress(sp.nullifierHash));
        assertEq(address(pool).balance, 1 ether - 0.6 ether + 0.3 ether); // spent 0.6, 0.3 came back
        // silence unused
        expectedClaim;
    }

    // --- spend: ERC20 withdrawal ---

    function test_spendErc20Withdrawal() public {
        token.mint(address(this), 5 ether);
        token.approve(address(pool), 5 ether);
        bytes32 c = _commitment(1, 2, address(token), 5 ether);
        pool.deposit(c, address(token), 5 ether);

        CloakPool.Intent memory intent = CloakPool.Intent({
            asset: address(token),
            target: recipient,
            data: "",
            relayer: relayer,
            claimInner: bytes32(0),
            returnAsset: address(token)
        });
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: bytes32(uint256(0x3333)),
            changeCommitment: _commitment(9, 9, address(token), 4 ether),
            spendValue: 0.9 ether,
            fee: 0.1 ether
        });
        pool.spend(sp, intent);

        assertEq(token.balanceOf(recipient), 0.9 ether);
        assertEq(token.balanceOf(relayer), 0.1 ether);
    }

    // --- proxy determinism ---

    function test_proxyAddressDeterministic() public {
        bytes32 salt = bytes32(uint256(0xABCD));
        address predicted = pool.proxyAddress(salt);

        bytes32 c = _commitment(1, 2, address(0), 1 ether);
        pool.deposit{value: 1 ether}(c, address(0), 1 ether);

        CloakPool.Intent memory intent = _ethWithdrawIntent();
        CloakPool.SpendProof memory sp = CloakPool.SpendProof({
            proof: hex"00",
            root: pool.currentRoot(),
            nullifierHash: salt,
            changeCommitment: _commitment(9, 9, address(0), 0.29 ether),
            spendValue: 0.7 ether,
            fee: 0.01 ether
        });
        pool.spend(sp, intent);

        assertGt(predicted.code.length, 0, "proxy deployed at predicted address");
        assertEq(CloakProxy(payable(predicted)).pool(), address(pool));
    }

    function test_intentHashMatchesOffchainRecipe() public view {
        CloakPool.Intent memory intent = _ethWithdrawIntent();
        bytes32 expected = bytes32(
            uint256(
                keccak256(
                    abi.encode(
                        block.chainid,
                        address(pool),
                        intent.target,
                        keccak256(intent.data),
                        intent.relayer,
                        intent.claimInner,
                        intent.returnAsset
                    )
                )
            ) % 21888242871839275222246405745257275088548364400416034343698204186575808495617
        );
        assertEq(pool.intentHash(intent), expected);
    }

    receive() external payable {}
}
