// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IVerifier} from "../../src/interfaces/IVerifier.sol";

/// @notice Verifier stub for exercising pool logic in isolation. Real proof
/// verification is covered separately in HonkVerifier.t.sol.
contract MockVerifier is IVerifier {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}

/// @notice Minimal ERC20 for tests.
contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Target that echoes back half of the ETH it receives, simulating a
/// contract call that returns funds to the ephemeral proxy.
contract EchoTarget {
    event Pinged(uint256 value);

    function ping() external payable returns (uint256) {
        payable(msg.sender).transfer(msg.value / 2);
        emit Pinged(msg.value);
        return msg.value;
    }
}
