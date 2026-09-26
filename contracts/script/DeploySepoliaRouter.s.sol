// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1 AND LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";

import { AquaSwapVMRouter } from "swap-vm/src/routers/AquaSwapVMRouter.sol";

import { OtomoProgram } from "../src/OtomoProgram.sol";
import { OtomoOrderBuilder } from "../src/OtomoOrderBuilder.sol";

/// @title DeploySepoliaRouter
/// @notice Redeploys the Otomo SwapVM stack on Sepolia bound to the official
///         1inch Aqua registry (0x1111…a90a). Aqua itself, mUSDC and mWETH are
///         kept as-is. Writes addresses to deployments/sepolia.json.
contract DeploySepoliaRouter is Script {
    // Official 1inch Aqua registry on Sepolia (docs/1inch Aqua contract addresses).
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    // Existing mock tokens (unchanged).
    address internal constant MOCK_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;
    address internal constant MOCK_WETH = 0xf7A9C97d0DC45A13cd7e3E17406fA61CA72d66FA;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        AquaSwapVMRouter router = new AquaSwapVMRouter(AQUA, address(0), deployer, "OtomoSwapVM", "1.0.0");
        OtomoProgram encoder = new OtomoProgram(AQUA);
        OtomoOrderBuilder builder = new OtomoOrderBuilder(AQUA, address(router), encoder);
        vm.stopBroadcast();

        console.log("deployer            :", deployer);
        console.log("Aqua (official)     :", AQUA);
        console.log("AquaSwapVMRouter    :", address(router));
        console.log("OtomoProgram        :", address(encoder));
        console.log("OtomoOrderBuilder   :", address(builder));

        string memory json = "sepolia";
        vm.serializeAddress(json, "aqua", AQUA);
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "usdc", MOCK_USDC);
        vm.serializeAddress(json, "weth", MOCK_WETH);
        vm.serializeAddress(json, "encoder", address(encoder));
        string memory out = vm.serializeAddress(json, "orderBuilder", address(builder));
        vm.writeJson(out, "./deployments/sepolia.json");
    }
}
