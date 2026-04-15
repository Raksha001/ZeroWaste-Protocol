// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract DustSweeperMulticall {
    using SafeERC20 for IERC20;

    struct Call {
        address target;
        bytes callData;
    }

    /// @notice Executes a sequence of swaps (via off-chain resolved routes) and ensures the result meets x402 requirements.
    /// @param userWallet The user's wallet address whose tokens are being swept (must have approved this contract)
    /// @param calls The array of multicall payloads (typically calls to Uniswap V3 / Universal Router)
    /// @param inputTokens The dust tokens we are swapping from (the user must have approved this contract to spend them)
    /// @param inputAmounts The exact amounts of the dust tokens to pull from the user
    /// @param router The AMM router address that will execute the swaps
    /// @param targetToken The ERC20 token expected back from the swaps (e.g., USDT)
    /// @param requiredAmount The exact amount the merchant expects
    /// @param merchantAddress The ultimate recipient of the x402 checkout payment
    function executeSweepAndPay(
        address userWallet,
        Call[] calldata calls,
        address[] calldata inputTokens,
        uint256[] calldata inputAmounts,
        address router,
        address targetToken,
        uint256 requiredAmount,
        address merchantAddress
    ) external {
        require(inputTokens.length == inputAmounts.length, "Mismatched inputs");

        // 1. Pull the dust tokens from userWallet and grant approval to the router
        for (uint256 i = 0; i < inputTokens.length; i++) {
            IERC20(inputTokens[i]).safeTransferFrom(userWallet, address(this), inputAmounts[i]);
            // Best practice with OpenZeppelin v5 for non-standard tokens (like USDT)
            IERC20(inputTokens[i]).forceApprove(router, type(uint256).max);
        }

        uint256 balanceBefore = IERC20(targetToken).balanceOf(address(this));

        // 2. Execute the sequence of swap calls on the router
        for (uint256 i = 0; i < calls.length; i++) {
             // For security, ensure the target is only the whitelisted/approved router
             require(calls[i].target == router, "Unauthorized swap target");
             
             (bool success, bytes memory returnData) = calls[i].target.call(calls[i].callData);
             if (!success) {
                 // Bubble up the revert reason if present
                 if (returnData.length > 0) {
                     assembly {
                         let returndata_size := mload(returnData)
                         revert(add(32, returnData), returndata_size)
                     }
                 } else {
                     revert("Router call failed");
                 }
             }
        }

        // 3. Verify the target token outcome
        uint256 balanceAfter = IERC20(targetToken).balanceOf(address(this));
        require(balanceAfter >= balanceBefore, "Invalid swap output");
        uint256 amountGained = balanceAfter - balanceBefore;

        // The Aha moment: ATOMIC REVERT if x402 requirements are not strictly met
        require(amountGained >= requiredAmount, "Insufficient swapped amount for x402 payment");

        // 4. Disburse to merchant
        IERC20(targetToken).safeTransfer(merchantAddress, requiredAmount);

        // 5. Refund excess output to the user
        if (amountGained > requiredAmount) {
            uint256 refund = amountGained - requiredAmount;
            IERC20(targetToken).safeTransfer(userWallet, refund);
        }

        // 6. Return unspent dust back to the user (e.g. if partial fills occurred)
        for (uint256 i = 0; i < inputTokens.length; i++) {
            uint256 remainingDust = IERC20(inputTokens[i]).balanceOf(address(this));
            if (remainingDust > 0) {
                IERC20(inputTokens[i]).safeTransfer(userWallet, remainingDust);
            }
            // Revoke router approval 
            IERC20(inputTokens[i]).forceApprove(router, 0);
        }
    }
}
