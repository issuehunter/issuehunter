pragma solidity ^0.4.11;


// TODO: contract description
contract Issuehunter {

    // The address of the entity that will verify proposed patches.
    address public patchVerifier;

    // The time in seconds between when a patch has been verified and when
    // funders can't rollback their funds anymore.
    uint public preRewardPeriod;

    // The time in seconds between the pre-reward period end and when the
    // verified patch's author can't withdraw campaign's reward anymore.
    uint public rewardPeriod;

    // A crowdfunding campaign.
    struct Campaign {
        // A flag that is true if a verified patch author's has been rewarded.
        bool rewarded;

        // The total amount of funds associated to the issue.
        uint total;

        // The address that created the campaign. Mainly used to check if a
        // campaign for a selected issue is already present in the `campaigns`
        // mappings.
        address createdBy;

        // A mapping between funders' addresses and their fund amount.
        //
        // By default funds amounts are zeroes.
        //
        // TODO: rename to "amounts"?
        mapping(address => uint) funds;

        // A mapping between author addresses and patches ids, that are commit
        // SHAs.
        mapping(address => bytes32) patches;

        // TODO: write doc
        uint preRewardPeriodExpiresAt;

        // TODO: write doc
        uint rewardPeriodExpiresAt;

        // The address of the entity that submitted a patch that has been
        // verified.
        //
        // Note: if this address is different from the default 0x0000000
        // address, then a submitted patch has been verified and `resolvedBy` is
        // the patch author's address.
        address resolvedBy;
    }

    // A mapping between issues (their ids) and campaigns.
    mapping(bytes32 => Campaign) public campaigns;

    event CampaignCreated(bytes32 indexed issueId, address creator, uint timestamp);
    event CampaignFunded(bytes32 indexed issueId, address funder, uint timestamp, uint amount);
    event PatchSubmitted(bytes32 indexed issueId, address resolvedBy, bytes32 commitSHA);
    event PatchVerified(bytes32 indexed issueId, address resolvedBy, bytes32 commitSHA);
    event RollbackFunds(bytes32 indexed issueId, address funder, uint amount);
    event WithdrawFunds(bytes32 indexed issueId, address resolvedBy);
    event WithdrawSpareFunds(bytes32 indexed issueId, address funder, uint amount);

    /// Create a new contract instance and set message sender as the patch
    //  verifier.
    function Issuehunter() {
        patchVerifier = msg.sender;
        // The default pre-reward period is one day
        preRewardPeriod = 86400;
        // The default execution period is one week.
        rewardPeriod = 604800;
    }

    /// Creates a new campaign.
    function createCampaign(bytes32 issueId) {
        // If the a campaigns for the selected issue exists already throws an
        // exception.
        require(campaigns[issueId].createdBy == 0);

        campaigns[issueId] = Campaign({
            rewarded: false,
            total: 0,
            createdBy: msg.sender,
            preRewardPeriodExpiresAt: 0,
            rewardPeriodExpiresAt: 0,
            resolvedBy: 0
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

        // TODO: require that a campaign hasn't any verified patch

        // Add funds to the list, and update campaign's funds total amount
        campaigns[issueId].funds[msg.sender] += msg.value;
        campaigns[issueId].total += msg.value;

        CampaignFunded(issueId, msg.sender, now, msg.value);
    }

    // Submit a new patch.
    //
    // TODO: the submitter must pay a fee to let the patch verifier send the
    // transaction that verifies the submitted patch.
    function submitResolution(bytes32 issueId, bytes32 commitSHA) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if sender already submitted the same patch
        require(campaigns[issueId].patches[msg.sender] == 0 || campaigns[issueId].patches[msg.sender] != commitSHA);

        // TODO: require that a campaign hasn't any verified patch

        campaigns[issueId].patches[msg.sender] = commitSHA;

        PatchSubmitted(issueId, msg.sender, commitSHA);
    }

    // Verify a patch.
    //
    // Only the patch verifier can invoke this function.
    //
    // The patch verifier must verify that:
    //
    // 1. the patch is a real solution for the selected issue, for instance by
    //    checking that the project's master branch includes the commit SHA that
    //    has been submitted
    // 2. the patch author address is included in the commit message
    //
    // The function will throw an exception if the patch author's address and
    // the associated patch commit SHA don't match with the function arguments.
    // This will prevent concurrent updates of a patch submitted by the same
    // author.
    function verifyResolution(bytes32 issueId, address author, bytes32 commitSHA) {
        // Only patch verifier is allowed to call this function
        require(msg.sender == patchVerifier);
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if author didn't submit the selected patch
        require(campaigns[issueId].patches[author] == commitSHA);
        // Fail if a patche has been already verified
        require(campaigns[issueId].resolvedBy == 0);

        campaigns[issueId].resolvedBy = author;
        campaigns[issueId].preRewardPeriodExpiresAt = now + preRewardPeriod;
        campaigns[issueId].rewardPeriodExpiresAt = campaigns[issueId].preRewardPeriodExpiresAt + rewardPeriod;

        PatchVerified(issueId, author, campaigns[issueId].patches[author]);
    }

    // Campaign funders can withdraw their fund from a campaign under certain
    // conditions.
    //
    // They can't withdraw their funds after `preRewardPeriod` seconds have
    // passed from the time when a patch has been verified.
    //
    // Withdrawing campaign funds after a submitted patch has been verified will
    // incur in a fee. The fee will be added to funds from the null address
    // (0x0000000) and it will be included in the campaign's total reward
    // amount.
    function rollbackFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if the issue hasn't been resolved yet
        require(campaigns[issueId].resolvedBy != 0);
        // Fail if reward period has expired
        require(now <= campaigns[issueId].preRewardPeriodExpiresAt);

        uint amount = _rollbackFunds(campaigns[issueId], msg.sender);

        // TODO: add negative reputation to the MAIN contract
        // TODO: move part of the funds to 0x0000000's funds as partial reward

        RollbackFunds(issueId, msg.sender, amount);
    }

    // The submitter of the verified patch for the campaign can call this
    // function under certain conditions to withdraw the campaign's total amount
    // as a reward for his/her work.
    //
    // Campaign funds can be withdrawn if:
    //
    // * `preRewardPeriodExpiresAt` has passed
    // * `rewardPeriodExpiresAt` hasn't passed
    // * the patch has been verified and the address requesting the transaction
    //   is the one stored as the verified patch's author (`resolvedBy`)
    function withdrawFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if all funds have been rolled back
        require(campaigns[issueId].total > 0);
        // A campaign can be rewarded only once
        require(!campaigns[issueId].rewarded);
        // Only the verified patch's author is allowed to withdraw funds
        require(msg.sender == campaigns[issueId].resolvedBy);
        // Withdraw can happen only within the execution period, that is after
        // reward period has expired and before execution period expires
        require(now > campaigns[issueId].preRewardPeriodExpiresAt);
        // TODO: remove this check (?), why prevent a verified patch's author to
        // withdraw a reward even after the `rewardPeriodExpiresAt` has passed?
        require(now <= campaigns[issueId].rewardPeriodExpiresAt);

        campaigns[issueId].rewarded = true;
        msg.sender.transfer(campaigns[issueId].total);
        WithdrawFunds(issueId, msg.sender);

        // TODO: archive campaign (?)
        //
        // If we archive campaigns we can create new campaigns for the same
        // issue, but at the same time there can always be at most one active
        // campaign per issue id.
    }

    // TODO: create a new "archive" function to archive a campaign (?)
    //
    // This function would come in handy if the verified patch's author doesn't
    // withdraw the reward (maybe because archiving an issue is more expensive
    // then the reward?), but someone else would like to start a new campaign.
    //
    // What should we do about the campaign funds in that case?
    //
    // Whould they go in a global fund?
    //
    // Maybe "createCampaign" could check if there is any archived function that
    // has an unclaimed reward and add it by default to the funds associated to
    // the 0x0000000 address?
    //
    // What if instead of "archive", "createCampaign" just does this?

    // Campaign backers have one last chance to withdraw their funds under
    // certain conditions.
    //
    // Any backer of the campaign is able to withdraw his/her fund if:
    //
    // * `rewardPeriodExpiresAt` has passed
    // * the verified patch's author didn't withdraw the campaign reward yet
    // * the backer didn't withdraw their funds yet
    function withdrawSpareFunds(bytes32 issueId) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Funders can't withdraw spare funds if a patch has been verified and
        // the campaign has been rewarded
        require(campaigns[issueId].resolvedBy != 0 && !campaigns[issueId].rewarded);
        // Funders can withdraw spare funds only after execute period has
        // expired
        require(now > campaigns[issueId].rewardPeriodExpiresAt);

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

    ////////////////////////////////////////////////////////////////////////////
    // Getters
    ////////////////////////////////////////////////////////////////////////////
    function campaignFunds(bytes32 issueId, address funder) returns (uint amount) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].funds[funder];
    }

    function campaignResolutions(bytes32 issueId, address author) returns (bytes32 commitSHA) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].patches[author];
    }
}
