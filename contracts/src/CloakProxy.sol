// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title CloakProxy
/// @notice Ephemeral, per-spend execution address. Deployed by `CloakPool`
/// via CREATE2 with a spend-specific salt, so its address is deterministic and
/// unlinkable to the depositor. The pool funds it, then tells it to either
/// transfer funds onward (withdrawal / payment) or call a contract (forwarded
/// transaction). Any funds returned to this address are later swept by the pool
/// into a claim note.
///
/// Only the deploying pool can drive it. It holds no secrets; it is a dumb,
/// single-tenant hand that the pool controls.
contract CloakProxy {
    error NotPool();
    error CallFailed(bytes returnData);
    error TransferFailed();

    address public immutable pool;

    constructor() {
        pool = msg.sender;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    /// @notice Forward funds/intent as instructed by the pool.
    /// @param asset The asset being spent (address(0) == native ETH).
    /// @param target Destination address or contract.
    /// @param value Amount of `asset` to move.
    /// @param data Calldata. Empty => plain transfer; non-empty => contract call.
    /// @return returnData The raw return data of a contract call (empty for transfers).
    function execute(address asset, address target, uint256 value, bytes calldata data)
        external
        onlyPool
        returns (bytes memory returnData)
    {
        if (data.length == 0) {
            // Plain transfer: withdrawal, private payment, or claim-out.
            if (asset == address(0)) {
                (bool ok,) = target.call{value: value}("");
                if (!ok) revert TransferFailed();
            } else {
                _safeTransfer(asset, target, value);
            }
            return "";
        }

        // Contract call.
        if (asset == address(0)) {
            (bool ok, bytes memory ret) = target.call{value: value}(data);
            if (!ok) revert CallFailed(ret);
            return ret;
        } else {
            // Approve the target to pull `value` tokens, then call it.
            _safeApprove(asset, target, value);
            (bool ok, bytes memory ret) = target.call(data);
            if (!ok) revert CallFailed(ret);
            // Drop any leftover allowance so nothing lingers on this address.
            _safeApprove(asset, target, 0);
            return ret;
        }
    }

    /// @notice Send this proxy's entire balance of `asset` back to the pool so
    /// it can be minted into a claim note. Callable only by the pool.
    /// @return amount The swept amount.
    function sweep(address asset) external onlyPool returns (uint256 amount) {
        if (asset == address(0)) {
            amount = address(this).balance;
            if (amount > 0) {
                (bool ok,) = pool.call{value: amount}("");
                if (!ok) revert TransferFailed();
            }
        } else {
            amount = _balanceOf(asset);
            if (amount > 0) {
                _safeTransfer(asset, pool, amount);
            }
        }
    }

    receive() external payable {}

    // --- minimal SafeERC20 (no external dependency) ---

    function _balanceOf(address token) private view returns (uint256) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || data.length < 32) revert TransferFailed();
        return abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSignature("transfer(address,uint256)", to, value));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeApprove(address token, address spender, uint256 value) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSignature("approve(address,uint256)", spender, value));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
