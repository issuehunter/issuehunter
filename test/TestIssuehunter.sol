pragma solidity ^0.4.2;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/Issuehunter.sol";


contract TestIssuehunter {

    function testInitialIssueManagerUsingDeployedContract() {
        Issuehunter issuehunter = Issuehunter(DeployedAddresses.Issuehunter());

        Assert.equal(issuehunter.issueManager(), tx.origin, "Contract creator should be the issue manager");
    }

    function testInitialIssueManagerWithNewIssuehunter() {
        Issuehunter issuehunter = new Issuehunter();

        Assert.equal(issuehunter.issueManager(), tx.origin, "Contract creator should be the issue manager");
    }

}
