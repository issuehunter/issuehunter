pragma solidity ^0.4.2;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/Issuehunter.sol";


contract TestIssuehunter {

    function testInitialIssueManagerUsingDeployedContract() {
        Issuehunter issuehunter = Issuehunter(DeployedAddresses.Issuehunter());

        Assert.equal(issuehunter.defaultPatchVerifier(), tx.origin, "Contract creator should be the default patch verifier");
    }

    function testInitialIssueManagerWithNewIssuehunter() {
        Issuehunter issuehunter = new Issuehunter();

        Assert.equal(issuehunter.defaultPatchVerifier(), this, "Contract creator should be the default patch verifier");
    }

}
