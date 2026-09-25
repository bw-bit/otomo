// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { AquaOpcodes } from "swap-vm/src/opcodes/AquaOpcodes.sol";
import { Controls, ControlsArgsBuilder } from "swap-vm/src/instructions/Controls.sol";
import { Fee, FeeArgsBuilder } from "swap-vm/src/instructions/Fee.sol";
import { XYCSwap } from "swap-vm/src/instructions/XYCSwap.sol";
import { Program, ProgramBuilder } from "swap-vm/test/utils/ProgramBuilder.sol";

/// @title OtomoProgram
/// @notice Encodes the SwapVM program for the Otomo Aqua strategy.
/// @dev Deployed only as a bytecode encoder; the Aqua opcode index for each
///      instruction is resolved by function-pointer comparison (ProgramBuilder),
///      so the encoding stays correct for the pinned swap-vm version.
///      Program layout (order is security-critical, see swap-vm docs/PROGRAMS.md):
///        Deadline -> FlatFeeAmountIn -> XYCSwap -> Salt
contract OtomoProgram is AquaOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) AquaOpcodes(aqua) { }

    /// @param deadline Unix timestamp after which swaps revert (uint40, 5-byte arg)
    /// @param feeBps Flat fee charged on amountIn, 1e9 = 100% (uint32, 4-byte arg)
    /// @param salt   Arbitrary bytes making the order hash unique
    function buildProgram(
        uint40 deadline,
        uint32 feeBps,
        uint256 salt
    ) external pure returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Controls._deadline, ControlsArgsBuilder.buildDeadline(deadline)),
            p.build(Fee._flatFeeAmountInXD, FeeArgsBuilder.buildFlatFee(feeBps)),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }
}
