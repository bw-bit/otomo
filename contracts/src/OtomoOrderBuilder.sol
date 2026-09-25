// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1 AND LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

/// @custom:license-url https://github.com/1inch/swap-vm/blob/main/LICENSES/SwapVM-1.1.txt
/// @custom:license-url https://github.com/1inch/aqua/blob/main/LICENSES/Aqua-Source-1.1.txt
/// @custom:copyright © 2025 Degensoft Ltd

import { ISwapVM } from "swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "swap-vm/src/libs/TakerTraits.sol";

import { OtomoProgram } from "./OtomoProgram.sol";

/// @title OtomoOrderBuilder
/// @notice On-chain encoder for Otomo Aqua orders so the frontend does not have
///         to reimplement MakerTraits/TakerTraits packing in TypeScript.
/// @dev Mirrors the order built in script/Demo.s.sol.
contract OtomoOrderBuilder {
    address public immutable aqua;
    address public immutable router;
    OtomoProgram public immutable encoder;

    constructor(address aqua_, address router_, OtomoProgram encoder_) {
        aqua = aqua_;
        router = router_;
        encoder = encoder_;
    }

    /// @notice Build the maker order for the Aqua strategy.
    /// @return order    The ISwapVM order (maker, traits, data)
    /// @return strategy abi.encode(order), i.e. the `strategy` arg of aqua.ship;
    ///                  Aqua computes strategyHash = keccak256(strategy)
    function buildOrder(
        address maker,
        uint40 deadline,
        uint32 feeBps,
        uint256 salt
    ) external view returns (ISwapVM.Order memory order, bytes memory strategy) {
        order = MakerTraitsLib.build(MakerTraitsLib.Args({
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
            program: encoder.buildProgram(deadline, feeBps, salt)
        }));
        strategy = abi.encode(order);
    }

    /// @notice Build taker traits+data for an exact-in swap paying `tokenIn`.
    /// @param minAmountOut Slippage bound (0 = none)
    function buildTakerData(address taker, uint256 minAmountOut) external pure returns (bytes memory) {
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
