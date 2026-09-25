// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1 AND LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { AquaSwapVMRouter } from "swap-vm/src/routers/AquaSwapVMRouter.sol";
import { ISwapVM } from "swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/src/libs/TakerTraits.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { OtomoProgram } from "../src/OtomoProgram.sol";

contract OtomoStrategyTest is Test {
    uint32 internal constant FEE_BPS = 0.003e9; // 0.3% flat fee on amountIn
    uint256 internal constant SALT = uint256(uint160(0x070));

    uint256 internal constant SHIP_USDC = 1_000e6;
    uint256 internal constant SHIP_WETH = 0.5e18;
    uint256 internal constant SWAP_IN = 0.01e18; // taker pays 0.01 mWETH

    Aqua internal aqua;
    AquaSwapVMRouter internal router;
    MockERC20 internal mUSDC;
    MockERC20 internal mWETH;
    OtomoProgram internal encoder;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    uint40 internal deadline;
    ISwapVM.Order internal order;
    bytes32 internal strategyHash;

    function setUp() public {
        aqua = new Aqua();
        router = new AquaSwapVMRouter(address(aqua), address(0), address(this), "OtomoSwapVM", "1.0.0");
        mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        mWETH = new MockERC20("Mock WETH", "mWETH", 18);
        encoder = new OtomoProgram(address(aqua));

        deadline = uint40(block.timestamp + 1 days);
        order = _buildOrder(FEE_BPS, deadline, SALT);

        mUSDC.mint(maker, 2_000e6);
        mWETH.mint(maker, 1e18);
        mWETH.mint(taker, 0.1e18);

        vm.prank(maker);
        mUSDC.approve(address(aqua), type(uint256).max);
        vm.prank(maker);
        mWETH.approve(address(aqua), type(uint256).max);
        vm.prank(taker);
        mWETH.approve(address(router), type(uint256).max);

        vm.prank(maker);
        strategyHash = aqua.ship(
            address(router),
            abi.encode(order),
            _tokens(),
            _shipAmounts()
        );
        assertEq(strategyHash, router.hash(order), "ship hash must equal order hash");
    }

    function test_walletFundsStayWithMakerAfterShip() public view {
        // Strategy shipped but no tokens left the maker's wallet.
        assertEq(mUSDC.balanceOf(maker), 2_000e6);
        assertEq(mWETH.balanceOf(maker), 1e18);

        (uint256 vUsdc, uint256 vWeth) = aqua.safeBalances(
            maker, address(router), strategyHash, address(mUSDC), address(mWETH)
        );
        assertEq(vUsdc, SHIP_USDC);
        assertEq(vWeth, SHIP_WETH);
    }

    function test_swapExactIn_movesRealTokens() public {
        bytes memory takerData = _takerData(0);
        (uint256 qIn, uint256 qOut,) = router.quote(order, address(mWETH), address(mUSDC), SWAP_IN, takerData);

        uint256 makerWethBefore = mWETH.balanceOf(maker);
        uint256 makerUsdcBefore = mUSDC.balanceOf(maker);
        uint256 takerWethBefore = mWETH.balanceOf(taker);
        uint256 takerUsdcBefore = mUSDC.balanceOf(taker);

        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, _takerData(qOut));

        assertEq(amountIn, qIn, "swap amountIn != quote");
        assertEq(amountOut, qOut, "swap amountOut != quote");
        assertEq(amountIn, SWAP_IN);

        // Taker paid mWETH and received mUSDC.
        assertEq(mWETH.balanceOf(taker), takerWethBefore - amountIn);
        assertEq(mUSDC.balanceOf(taker), takerUsdcBefore + amountOut);

        // Maker wallet gained the full amountIn (fee included, credited to the
        // strategy) and lost amountOut of mUSDC, straight from its own wallet.
        assertEq(mWETH.balanceOf(maker), makerWethBefore + amountIn);
        assertEq(mUSDC.balanceOf(maker), makerUsdcBefore - amountOut);

        // Aqua virtual balances moved in sync.
        (uint256 vUsdc, uint256 vWeth) = aqua.safeBalances(
            maker, address(router), strategyHash, address(mUSDC), address(mWETH)
        );
        assertEq(vUsdc, SHIP_USDC - amountOut);
        assertEq(vWeth, SHIP_WETH + amountIn);
    }

    function test_fee_makesOutputWorseForTaker() public {
        // Same strategy without the fee must give the taker strictly more out.
        ISwapVM.Order memory noFeeOrder = _buildOrder(0, deadline, SALT + 1);
        vm.prank(maker);
        aqua.ship(address(router), abi.encode(noFeeOrder), _tokens(), _shipAmounts());

        bytes memory takerData = _takerData(0);
        (, uint256 outWithFee,) = router.quote(order, address(mWETH), address(mUSDC), SWAP_IN, takerData);
        (, uint256 outNoFee,) = router.quote(noFeeOrder, address(mWETH), address(mUSDC), SWAP_IN, takerData);

        assertLt(outWithFee, outNoFee, "flat fee did not reduce taker output");
        // The difference is the fee kept inside the strategy's balances.
        assertGt(outNoFee - outWithFee, 0);
    }

    function test_swapRevertsAfterDeadline() public {
        vm.warp(uint256(deadline) + 1);
        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, _takerData(0));
    }

    function test_swapRevertsAfterDock() public {
        vm.prank(maker);
        aqua.dock(address(router), strategyHash, _tokens());

        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, _takerData(0));
    }

    // ===== helpers =====

    function _tokens() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(mUSDC);
        tokens[1] = address(mWETH);
    }

    function _shipAmounts() internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = SHIP_USDC;
        amounts[1] = SHIP_WETH;
    }

    function _buildOrder(uint32 feeBps, uint40 deadline_, uint256 salt)
        internal
        view
        returns (ISwapVM.Order memory)
    {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            receiver: address(0),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: encoder.buildProgram(deadline_, feeBps, salt)
        }));
    }

    /// @dev minAmountOut == 0 means no slippage bound (used for quote calls).
    function _takerData(uint256 minAmountOut) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: true,
            threshold: minAmountOut == 0 ? bytes("") : abi.encode(minAmountOut),
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }
}
