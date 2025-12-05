// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract IDOSToken is ERC20, ERC20Burnable, ERC20Permit {
    constructor(address initialTreasury, address initialOwner)
        ERC20("IDOSToken", "IDOS")
        ERC20Permit("IDOSToken")
    {
        _mint(initialTreasury, 1_000_000_000 * 10 ** decimals());
    }

    // Prevent accidental ETH transfers
    receive() external payable { revert(); }
    fallback() external payable { revert(); }
}
