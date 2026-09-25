// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { AquaSwapVMRouter } from "swap-vm/src/routers/AquaSwapVMRouter.sol";
import { ISwapVM } from "swap-vm/src/interfaces/ISwapVM.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { OtomoProgram } from "../src/OtomoProgram.sol";
import { OtomoOrderBuilder } from "../src/OtomoOrderBuilder.sol";

/// @notice Same ship -> quote -> swap flow as OtomoStrategyTest, but the order
///         and taker data are produced on-chain by OtomoOrderBuilder (the path
///         the app uses).
contract OtomoOrderBuilderTest is Test {
    uint32 internal constant FEE_BPS = 0.003e9; // 0.3% flat fee on amountIn
    uint256 internal constant SALT = uint256(uint160(0x070));
    uint256 internal constant SHIP_USDC = 1_000e6;
    uint256 internal constant SHIP_WETH = 0.5e18;
    uint256 internal constant SWAP_IN = 0.01e18;

    Aqua internal aqua;
    AquaSwapVMRouter internal router;
    MockERC20 internal mUSDC;
    MockERC20 internal mWETH;
    OtomoProgram internal encoder;
    OtomoOrderBuilder internal builder;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    uint40 internal deadline;
    bytes32 internal strategyHash;

    function setUp() public {
        aqua = new Aqua();
        router = new AquaSwapVMRouter(address(aqua), address(0), address(this), "OtomoSwapVM", "1.0.0");
        mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        mWETH = new MockERC20("Mock WETH", "mWETH", 18);
        encoder = new OtomoProgram(address(aqua));
        builder = new OtomoOrderBuilder(address(aqua), address(router), encoder);

        deadline = uint40(block.timestamp + 1 days);

        mUSDC.mint(maker, 2_000e6);
        mWETH.mint(maker, 1e18);
        mWETH.mint(taker, 0.1e18);

        vm.prank(maker);
        mUSDC.approve(address(aqua), type(uint256).max);
        vm.prank(maker);
        mWETH.approve(address(aqua), type(uint256).max);
        vm.prank(taker);
        mWETH.approve(address(router), type(uint256).max);
    }

    function _ship(ISwapVM.Order memory order, bytes memory strategy) internal {
        address[] memory tokens = new address[](2);
        tokens[0] = address(mUSDC);
        tokens[1] = address(mWETH);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = SHIP_USDC;
        amounts[1] = SHIP_WETH;
        vm.prank(maker);
        strategyHash = aqua.ship(address(router), strategy, tokens, amounts);
    }

    function test_buildOrder_shipsAndSwaps() public {
        (ISwapVM.Order memory order, bytes memory strategy) = builder.buildOrder(maker, deadline, FEE_BPS, SALT);
        assertEq(order.maker, maker);
        _ship(order, strategy);

        // Aqua derives strategyHash = keccak256(strategy) — the app computes the
        // same value off-chain in computeStrategyHash (src/lib/aqua.ts).
        assertEq(strategyHash, keccak256(strategy));
        assertEq(strategyHash, router.hash(order));

        (uint256 qIn, uint256 qOut,) =
            router.quote(order, address(mWETH), address(mUSDC), SWAP_IN, builder.buildTakerData(taker, 0));

        uint256 makerWethBefore = mWETH.balanceOf(maker);
        uint256 takerUsdcBefore = mUSDC.balanceOf(taker);

        bytes memory takerData = builder.buildTakerData(taker, qOut);
        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, takerData);

        assertEq(amountIn, qIn);
        assertEq(amountOut, qOut);
        assertEq(mWETH.balanceOf(maker), makerWethBefore + amountIn);
        assertEq(mUSDC.balanceOf(taker), takerUsdcBefore + amountOut);
    }

    function test_swapRevertsAfterDeadline() public {
        (ISwapVM.Order memory order, bytes memory strategy) = builder.buildOrder(maker, deadline, FEE_BPS, SALT);
        _ship(order, strategy);
        bytes memory takerData = builder.buildTakerData(taker, 0);
        vm.warp(uint256(deadline) + 1);
        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, takerData);
    }
}
