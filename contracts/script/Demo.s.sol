// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1 AND LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

import { AquaSwapVMRouter } from "swap-vm/src/routers/AquaSwapVMRouter.sol";
import { ISwapVM } from "swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/src/libs/TakerTraits.sol";

import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { OtomoProgram } from "../src/OtomoProgram.sol";

/// @title Demo
/// @notice End-to-end Otomo strategy demo on a local anvil chain:
///         maker (user) ships an AMM strategy to Aqua while funds stay in the
///         maker's wallet; a third-party taker swap moves real tokens; fees
///         accrue to the maker's strategy; maker docks the strategy at the end.
contract Demo is Script {
    // Anvil's well-known dev accounts (public keys, local chain only).
    uint256 internal constant DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant MAKER_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant TAKER_KEY =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

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

    address internal maker;
    address internal taker;
    bytes32 internal strategyHash;

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", DEPLOYER_KEY);
        uint256 makerKey = vm.envOr("MAKER_PRIVATE_KEY", MAKER_KEY);
        uint256 takerKey = vm.envOr("TAKER_PRIVATE_KEY", TAKER_KEY);
        address deployer = vm.addr(deployerKey);
        maker = vm.addr(makerKey);
        taker = vm.addr(takerKey);

        console.log("=== Otomo Aqua + SwapVM demo ===");
        console.log("maker (user):", maker);
        console.log("taker       :", taker);

        // ---- deploy + fund -------------------------------------------------
        vm.startBroadcast(deployerKey);
        aqua = new Aqua();
        router = new AquaSwapVMRouter(address(aqua), address(0), deployer, "OtomoSwapVM", "1.0.0");
        mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        mWETH = new MockERC20("Mock WETH", "mWETH", 18);
        encoder = new OtomoProgram(address(aqua));

        mUSDC.mint(maker, 2_000e6);
        mWETH.mint(maker, 1e18);
        mWETH.mint(taker, 0.1e18);
        vm.stopBroadcast();

        console.log("Aqua               :", address(aqua));
        console.log("AquaSwapVMRouter   :", address(router));
        console.log("mUSDC (6dp)        :", address(mUSDC));
        console.log("mWETH (18dp)       :", address(mWETH));
        _logState("--- after deploy/mint ---");

        // ---- maker ships strategy to Aqua ----------------------------------
        uint40 deadline = uint40(block.timestamp + 1 days);
        ISwapVM.Order memory order = _order(deadline);

        vm.startBroadcast(makerKey);
        mUSDC.approve(address(aqua), type(uint256).max);
        mWETH.approve(address(aqua), type(uint256).max);
        strategyHash = aqua.ship(
            address(router),
            abi.encode(order),
            _tokens(),
            _shipAmounts()
        );
        vm.stopBroadcast();

        console.log("strategyHash:");
        console.logBytes32(strategyHash);
        _logState("--- after ship: funds still in maker wallet ---");

        // ---- taker quotes ----------------------------------------------------
        bytes memory quoteData = _takerData(0);
        (uint256 qIn, uint256 qOut,) =
            router.quote(order, address(mWETH), address(mUSDC), SWAP_IN, quoteData);
        console.log("quote: pay   %s mWETH (raw)", qIn);
        console.log("quote: get   %s mUSDC (raw)", qOut);

        // ---- taker swaps -----------------------------------------------------
        vm.startBroadcast(takerKey);
        mWETH.approve(address(router), type(uint256).max);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(order, address(mWETH), address(mUSDC), SWAP_IN, _takerData(qOut));
        vm.stopBroadcast();

        console.log("swap : paid  %s mWETH, got %s mUSDC", amountIn, amountOut);
        _logState("--- after swap: fee accrued to maker strategy ---");

        // ---- maker docks -----------------------------------------------------
        vm.startBroadcast(makerKey);
        aqua.dock(address(router), strategyHash, _tokens());
        vm.stopBroadcast();

        _logState("--- after dock: strategy closed ---");
        console.log("=== demo done ===");
    }

    function _logState(string memory label) internal view {
        console.log(label);
        console.log("  maker wallet  mUSDC: %s | mWETH: %s", mUSDC.balanceOf(maker), mWETH.balanceOf(maker));
        console.log("  taker wallet  mUSDC: %s | mWETH: %s", mUSDC.balanceOf(taker), mWETH.balanceOf(taker));
        (uint256 vUsdc,) = aqua.rawBalances(maker, address(router), strategyHash, address(mUSDC));
        (uint256 vWeth,) = aqua.rawBalances(maker, address(router), strategyHash, address(mWETH));
        console.log("  aqua virtual  mUSDC: %s | mWETH: %s", vUsdc, vWeth);
    }

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

    function _order(uint40 deadline) internal view returns (ISwapVM.Order memory) {
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
            program: encoder.buildProgram(deadline, FEE_BPS, SALT)
        }));
    }

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
