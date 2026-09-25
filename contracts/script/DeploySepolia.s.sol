// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1 AND LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { AquaSwapVMRouter } from "swap-vm/src/routers/AquaSwapVMRouter.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { OtomoProgram } from "../src/OtomoProgram.sol";
import { OtomoOrderBuilder } from "../src/OtomoOrderBuilder.sol";

/// @title DeploySepolia
/// @notice Deploys the Otomo Aqua stack to Sepolia (Aqua is not officially
///         deployed there). mUSDC is the existing ENS MockUSDC, so only mWETH
///         is deployed as a mock. Writes addresses to deployments/sepolia.json.
contract DeploySepolia is Script {
    // ENS MockUSDC on Sepolia (permissionless mint, 6 decimals) — see docs/research.md
    address internal constant MOCK_USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        Aqua aqua = new Aqua();
        AquaSwapVMRouter router = new AquaSwapVMRouter(address(aqua), address(0), deployer, "OtomoSwapVM", "1.0.0");
        MockERC20 mWETH = new MockERC20("Mock WETH", "mWETH", 18);
        OtomoProgram encoder = new OtomoProgram(address(aqua));
        OtomoOrderBuilder builder = new OtomoOrderBuilder(address(aqua), address(router), encoder);
        vm.stopBroadcast();

        console.log("deployer            :", deployer);
        console.log("Aqua                :", address(aqua));
        console.log("AquaSwapVMRouter    :", address(router));
        console.log("MockUSDC (existing) :", MOCK_USDC);
        console.log("mWETH               :", address(mWETH));
        console.log("OtomoProgram        :", address(encoder));
        console.log("OtomoOrderBuilder   :", address(builder));

        string memory json = "sepolia";
        vm.serializeAddress(json, "aqua", address(aqua));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "usdc", MOCK_USDC);
        vm.serializeAddress(json, "weth", address(mWETH));
        vm.serializeAddress(json, "encoder", address(encoder));
        string memory out = vm.serializeAddress(json, "orderBuilder", address(builder));
        vm.writeJson(out, "./deployments/sepolia.json");
    }
}
