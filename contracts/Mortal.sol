pragma solidity ^0.4.11;

import "./Owned.sol";


contract Mortal is Owned {
    /* Function to recover the funds on the contract */
    function kill() onlyOwner { selfdestruct(owner); }
}
