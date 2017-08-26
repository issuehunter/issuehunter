pragma solidity ^0.4.11;


// TODO: contract description
contract Issuehunter {

    // The address of the entity that can very proposed resolutions.
    // TODO: rename (?) "campaign manager", "resolution verifier"
    address public issueManager;

    // The time in seconds between when a resolution has been verified and when
    // funders can't rollback their funds anymore.
    // TODO: rename to preRewardPeriod
    uint public defaultRewardPeriod;

    // The time in seconds between the reward period end and when the resolutor
    // can't withdraw campaign's funds anymore.
    // TODO: rename to rewardPeriod
    uint public defaultExecutePeriod;

    // A crowdfunding campaign.
    struct Campaign {
        // A flag that stores the information that a proposed resolution reward
        // has been assigned.
        // TODO: rename to "rewarded" ?
        bool executed;

        // The total amount of funds associated to the issue.
        uint total;

        // The address that created the campaign. Mainly used to check if a campaign
        // for a selected issue is already present in the `campaigns` mappings.
        address createdBy;

        // A mapping between funders' addresses and their fund amount.
        // By default funds amounts are zeroes.
        // TODO: rename to "amounts"?
        mapping(address => uint) funds;

        // A mapping between resolution proposers addresses and resolution ids.
        // A proposed resolution id
        // TODO: rename to "proposed resolutions"?
        mapping(address => bytes32) resolutions;

        // TODO: write doc
        // TODO: rename to preRewardPeriodExpiresAt
        uint rewardPeriodExpiresAt;

        // TODO: write doc
        // TODO: rename to rewardPeriodExpiresAt
        uint executePeriodExpiresAt;

        // The address of the entity that proposed a resolution that has been
        // verified.
        //
        // Note: if this address is different from the default 0x0000000 address,
        // then a proposed resolution has been verified and `resolutor` is the
        // resolution author's address.
        // TODO: rename to "resolvedBy" (?)
        address resolutor;
    }

    // A mapping between issues (their ids) and campaigns.
    mapping(bytes32 => Campaign) public campaigns;

    event CampaignCreated(bytes32 indexed issueId, address creator, uint timestamp);
    event CampaignFunded(bytes32 indexed issueId, address funder, uint timestamp, uint amount);
    event ResolutionProposed(bytes32 indexed issueId, address resolutor, bytes32 commitSHA);
    event ResolutionVerified(bytes32 indexed issueId, address resolutor, bytes32 commitSHA);
    event RollbackFunds(bytes32 indexed issueId, address funder, uint amount);
    event WithdrawFunds(bytes32 indexed issueId, address resolutor);
    event WithdrawSpareFunds(bytes32 indexed issueId, address funder, uint amount);

    /// Create a new Issuehunter with message's sender as the issue manager.
    function Issuehunter() {
        issueManager = msg.sender;
        // The default reward period is one day
        defaultRewardPeriod = 86400;
        // The default execution period is one week.
        defaultExecutePeriod = 604800;
    }

    /// Creates a new campaign.
    function createCampaign(bytes32 issueId) {
        // If the a campaigns for the selected issue exists already throws an
        // exception.
        require(campaigns[issueId].createdBy == 0);

        campaigns[issueId] = Campaign({
            executed: false,
            total: 0,
            createdBy: msg.sender,
            rewardPeriodExpiresAt: 0,
            executePeriodExpiresAt: 0,
            resolutor: 0
        });

        CampaignCreated(issueId, msg.sender, now);
    }

    /// Add funds to the selected campaign.
    //
    // TODO: add issuehunter "tip". The tip could be used to compute the issue
    // campaign's rank in the list. Higher tips will make campaigns more visible
    // in the directory, by making them appear with a higher rank in the list.
    function fund(bytes32 issueId) payable {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        // TODO: require that a campaign hasn't any verified resolution

        // Add funds to the list, and update campaign's funds total amount
        campaigns[issueId].funds[msg.sender] += msg.value;
        campaigns[issueId].total += msg.value;

        CampaignFunded(
            issueId,
            msg.sender,
            now,
            msg.value
        );
    }

    // Submit a new resolution proposal.
    //
    // TODO: the submitter must pay a fee to let the issue manager send the
    // transaction that verifies the proposed resolution.
    function submitResolution(bytes32 issueId, bytes32 commitSHA) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if sender already submitted the same resolution
        require(campaigns[issueId].resolutions[msg.sender] == 0 || campaigns[issueId].resolutions[msg.sender] != commitSHA);

        // TODO: require that a campaign hasn't any verified resolution

        campaigns[issueId].resolutions[msg.sender] = commitSHA;

        ResolutionProposed(issueId, msg.sender, commitSHA);
    }

    // Verify a proposed resolution.
    //
    // Only the issue manager can invoke this function.
    //
    // The issue manager must verify that:
    //
    // 1. the proposed resolution is a real solution for the selected issue, for
    //    instance by checking that the project's master branch includes the
    //    commit SHA that has been proposed as a resolution
    // 2. the resolution submitter address is included in one of the commit
    //    messages in the branch that contains the resolution
    //
    // The function will throw an exception if the resolutor and its associated
    // patch commit SHA don't match to the function arguments. This will prevent
    // concurrent updates of a patch submitted by the same author.
    function verifyResolution(bytes32 issueId, address resolutor, bytes32 commitSHA) {
        // Only issue manager is allowed to call this function
        require(msg.sender == issueManager);
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if resolutor didn't submit the selected patch
        require(campaigns[issueId].resolutions[resolutor] == commitSHA);
        // Fail if a resolution has been already verified
        require(campaigns[issueId].resolutor == 0);

        campaigns[issueId].resolutor = resolutor;
        campaigns[issueId].rewardPeriodExpiresAt = now + defaultRewardPeriod;
        campaigns[issueId].executePeriodExpiresAt = campaigns[issueId].rewardPeriodExpiresAt + defaultExecutePeriod;

        ResolutionVerified(issueId, resolutor, campaigns[issueId].resolutions[resolutor]);
    }

    // Campaign funders can withdraw their fund from a campaign under certain
    // conditions.
    //
    // They can't withdraw their funds after `defaultRewardPeriod` seconds have
    // passed from the time when a proposed resolution has been verified.
    //
    // Withdrawing campaign funds after a proposed resolution has been verified
    // will incur in a fee. The fee will be added to funds from the null address
    // (0x0000000) and it will be included in the campaign's total reward amount.
    function rollbackFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if there's no verified resolution
        require(campaigns[issueId].resolutor != 0);
        // Fail if reward period has expired
        require(now <= campaigns[issueId].rewardPeriodExpiresAt);

        uint amount = _rollbackFunds(campaigns[issueId], msg.sender);

        // TODO: add negative reputation to the MAIN contract
        // TODO: move part of the funds to 0x0000000's funds as partial reward

        RollbackFunds(issueId, msg.sender, amount);
    }

    // The submitter of the verified resolution for the campaign can call this
    // function under certain conditions to withdraw the campaign's total amount
    // as a reward for his/her work.
    //
    // Campaign funds can't be withdrawn:
    //
    // * before `rewardPeriodExpiresAt` has expired
    // * after `executePeriodExpiresAt` has expired
    // * the resolution has been verified and the address requesting the
    //   transaction is the one stored as the issue's resolutor
    function withdrawFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if all funds have been rolled back
        require(campaigns[issueId].total > 0);
        // Funds can be withdrawed only once
        require(!campaigns[issueId].executed);
        // Only resolutor is allowed to withdraw funds
        require(msg.sender == campaigns[issueId].resolutor);
        // Withdraw can happen only within the execution period, that is after
        // reward period has expired and before execution period expires
        require(now > campaigns[issueId].rewardPeriodExpiresAt);
        // TODO: remove this check (?), why prevent a resolutor to withdraw a reward
        // even after the `executePeriodExpiresAt` has passed?
        require(now <= campaigns[issueId].executePeriodExpiresAt);

        campaigns[issueId].executed = true;
        msg.sender.transfer(campaigns[issueId].total);
        WithdrawFunds(issueId, msg.sender);

        // TODO: archive campaign (?)
        // If we archive campaigns we can create new campaigns for the same issue,
        // but at the same time there can always be at most one active campaign
        // per issue id.
    }

    // TODO: create a new "archive" function to archive a campaign (?)
    // This function would come in handy if the resolutor doesn't withdraw the
    // reward (maybe because archiving an issue is more expensive then the
    // reward?), but someone else would like to start a new campaign.
    // What should we do about the campaign funds in that case?
    // Whould they go in a global fund?
    // Maybe "createCampaign" could check if there is any archived function that
    // has an unclaimed reward and add it by default to the funds associated to
    // the 0x0000000 address?
    // What if instead of "archive", "createCampaign" just does this?

    // Campaign backers have one last chance to withdraw their funds under certain
    // conditions.
    //
    // Any backer of the campaign is able to withdraw his/her fund:
    //
    // * if a resolutor doesn't withdraw a campaign reward before
    //   `executePeriodExpiresAt` has passed
    // * if the resolutor didn't withdraw their reward
    function withdrawSpareFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Funders can't withdraw spare funds until a resolution has been
        // verified and the contract has been executed
        require(campaigns[issueId].resolutor != 0 && !campaigns[issueId].executed);
        // Funders can withdraw spare funds only after execute period has expired
        require(now > campaigns[issueId].executePeriodExpiresAt);

        uint amount = _rollbackFunds(campaigns[issueId], msg.sender);

        WithdrawSpareFunds(issueId, msg.sender, amount);
    }

    // TODO: add doc...
    function _rollbackFunds(Campaign storage campaign, address funder) internal returns (uint amount) {
        amount = campaign.funds[funder];
        require(amount > 0);

        campaign.funds[funder] = 0;
        campaign.total -= amount;
        funder.transfer(amount);

        return amount;
    }

    //////////////////////////////////////////////////////////////////////////////
    // Getters
    //////////////////////////////////////////////////////////////////////////////
    function campaignFunds(bytes32 issueId, address funder) returns (uint amount) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].funds[funder];
    }

    function campaignResolutions(bytes32 issueId, address resolutor) returns (bytes32 commitSHA) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].resolutions[resolutor];
    }
}
