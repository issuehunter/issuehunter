pragma solidity ^0.4.11;

contract IssueHunter {

    address issueManager;
    string public issueId;
    // default funds values are zeroes
    mapping(address => uint) public funds;
    mapping(address => string) public resolutions;
    uint public total;
    // time between resolution has been verified and funders can't rollback their funds anymore
    uint rewardPeriod;
    // time between the end of reward period and the time when resolutor can't withdraw funds anymore
    uint executePeriod;
    bool public executed = false;
    uint public rewardPeriodExpiresAt;
    uint public executePeriodExpiresAt;
    address public resolutor;

    event Fund(string indexed issueId, address indexed funder, uint indexed timestamp, uint amount);
    event Resolution(string indexed issueId, address indexed resolutor, string indexed commitSHA);
    event RollbackFunds(string indexed issueId, address indexed funder, uint amount);
    event WithdrawFunds(string indexed issueId, address indexed resolutor);
    event WithdrawSpareFunds(string indexed issueId, address indexed funder, uint amount);

    /// Create a new IssueHunter contract for $(_issueId) as issue ID and the
    /// message sender as issue manager.
    function IssueHunter(string _issueId, uint _rewardPeriod, uint _executePeriod) {
        issueManager = msg.sender;
        issueId = _issueId;
        rewardPeriod = _rewardPeriod;
        executePeriod = _executePeriod;
    }

    /// Add fund to this contract
    function fund() payable {
        funds[msg.sender] += msg.value;
        total += msg.value;
        Fund(issueId, msg.sender, now, msg.value);
    }

    function submitResolution(string commitSHA) {
        // fail if sender already submitted a resolution
        require(bytes(resolutions[msg.sender]).length == 0);

        resolutions[msg.sender] = commitSHA;
        Resolution(issueId, msg.sender, commitSHA);
    }

    function verifyResolution(address _resolutor) {
        // only issue manager is allowed to call this function
        require(msg.sender == issueManager);
        // fail if resolutor didn't submit any resolution yet
        require(bytes(resolutions[_resolutor]).length != 0);
        // fail if a resolution has been already verified
        require(resolutor == 0);

        resolutor = _resolutor;
        rewardPeriodExpiresAt = now + rewardPeriod;
        executePeriodExpiresAt = rewardPeriodExpiresAt + executePeriod;
    }

    function rollbackFunds() {
        // fail if there's no verified resolution
        require(resolutor != 0);
        // fail if reward period has expired
        require(now <= rewardPeriodExpiresAt);

        uint amount = _rollbackFunds(msg.sender);
        // TODO add negative reputation to the MAIN contract
        RollbackFunds(issueId, msg.sender, amount);
    }

    function withdrawFunds() {
        // fail if all funds have been rolled back
        require(total > 0);
        // funds can be withdrawed only once
        require(!executed);
        // only resolutor is allowed to withdraw funds
        require(msg.sender == resolutor);
        // withdraw can happen only within the execution period, that is after
        // reward period has expired and before execution period expires
        require(now > rewardPeriodExpiresAt);
        require(now <= executePeriodExpiresAt);

        executed = true;
        msg.sender.transfer(total);
        WithdrawFunds(issueId, msg.sender);
    }

    function withdrawSpareFunds()  {
        // funders can't withdraw spare funds if contract has been executed
        require(!executed);
        // funders can withdraw spare funds only after execute period has expired
        require(now >= executePeriodExpiresAt);

        uint amount = _rollbackFunds(msg.sender);
        WithdrawSpareFunds(issueId, msg.sender, amount);
    }

    function _rollbackFunds(address funder) internal returns (uint amount) {
        amount = funds[funder];
        require(amount > 0);

        funds[funder] = 0;
        total -= amount;
        funder.transfer(amount);
        return amount;
    }
}
