// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Script, console} from "forge-std/Script.sol";
import {HonkVerifier} from "../src/verifiers/HonkVerifier.sol";
import {CloakPool} from "../src/CloakPool.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

/// @notice Deploys the verifier and the pool from the key in `PRIVATE_KEY`.
///
/// Deploy + verify on Sepolia (reads SEPOLIA_RPC_URL / PRIVATE_KEY /
/// ETHERSCAN_API_KEY from the environment — see foundry.toml + .env.example):
///
///   forge script script/Deploy.s.sol \
///     --rpc-url sepolia --broadcast --verify
contract DeployScript is Script {
    function run() external returns (address verifier, address pool) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);
        HonkVerifier v = new HonkVerifier();
        CloakPool p = new CloakPool(IVerifier(address(v)));
        vm.stopBroadcast();

        verifier = address(v);
        pool = address(p);
        console.log("HonkVerifier:", verifier);
        console.log("CloakPool:", pool);
    }
}
