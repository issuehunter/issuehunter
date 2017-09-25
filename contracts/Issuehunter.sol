pragma solidity ^0.4.11;

import "./Mortal.sol";

// TODO: contract description
contract Issuehunter is Mortal {

    // The address of the entity that will manage proposed patches in case no
    // address is specified during campaign creation.
    address public defaultPatchVerifier;

    // The time in seconds between when a patch has been verified and when
    // funders can't rollback their funds anymore.
    uint public preRewardPeriod;

    // The time in seconds between the pre-reward period end and when the
    // verified patch's author can't withdraw campaign's reward anymore.
    uint public rewardPeriod;

    // The current amount of tips collected by the contract.
    uint public tipsAmount;

    // Estimated gas to execute `verifyPatch`. This value will be used to
    // calculate the patch verifier fee that should applied to submit patches.
    //
    // TODO: recalculate after fee application (!!!)
    uint public constant verifyPatchEstimatedGas = 65511;

    // Default tip per mille.
    uint public constant defaultTipPerMille = 50;

    // 1% is the minimum tip.
    uint public constant minTipPerMille = 10;

    // 20% is the maximum tip.
    uint public constant maxTipPerMille = 200;

    // A crowdfunding campaign.
    struct Campaign {
        // A flag that is true if a verified patch author's has been rewarded.
        bool rewarded;

        // The total amount of funds associated to the issue.
        // TODO: rename to "rewardAmount"?
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

        // A mapping between author addresses and patches ids, that are
        // references to commit SHAs.
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

        // The address of the entity that will verify proposed patches.
        address patchVerifier;

        // The campaign fund tip per mille for the platform.
        uint tipPerMille;

        // Campaign's tips amount.
        uint tipsAmount;
    }

    // A mapping between issues (their ids) and campaigns.
    mapping(bytes32 => Campaign) public campaigns;

    event CampaignCreated(bytes32 indexed issueId, address creator, uint timestamp);
    event CampaignFunded(bytes32 indexed issueId, address funder, uint timestamp, uint amount);
    event PatchSubmitted(bytes32 indexed issueId, address resolvedBy, bytes32 ref);
    event PatchVerified(bytes32 indexed issueId, address resolvedBy, bytes32 ref);
    event RollbackFunds(bytes32 indexed issueId, address funder, uint amount);
    event WithdrawReward(bytes32 indexed issueId, address resolvedBy, uint amount);
    event WithdrawSpareFunds(bytes32 indexed issueId, address funder, uint amount);
    event WithdrawTips(address owner, uint amount);

    /// Create a new contract instance and set message sender as the default
    //  patch verifier.
    function Issuehunter() public {
        defaultPatchVerifier = msg.sender;
        // The default pre-reward period is one day
        // TODO: make this value a constant
        preRewardPeriod = 86400;
        // The default execution period is one week.
        // TODO: make this value a constant
        rewardPeriod = 604800;
        // Initial tips amount.
        tipsAmount = 0;
    }

    /// Creates a new campaign with `defaultPatchVerifier` as the allowed
    //  address to verify patches, and the `defaultTipPerMille` as the per mille
    //  funds tip value.
    function createCampaign(bytes32 issueId) public {
        createCampaignExtended(issueId, defaultPatchVerifier, defaultTipPerMille);
    }

    /// Creates a new campaign.
    function createCampaignExtended(bytes32 issueId, address _patchVerifier, uint _tipPerMille) public {
        // If a campaign for the selected issue exists already throws an
        // exception.
        require(campaigns[issueId].createdBy == 0);
        // Requires that tip is valid, that is between `minTipPerMille` and
        // `maxTipPerMille`
        require(_tipPerMille >= minTipPerMille && _tipPerMille <= maxTipPerMille);

        // TODO: verify that `verifier` is a valid address

        campaigns[issueId] = Campaign({
            rewarded: false,
            total: 0,
            createdBy: msg.sender,
            preRewardPeriodExpiresAt: 0,
            rewardPeriodExpiresAt: 0,
            resolvedBy: 0,
            patchVerifier: _patchVerifier,
            tipPerMille: _tipPerMille,
            tipsAmount: 0
        });

        CampaignCreated(issueId, msg.sender, now);
    }

    /// Add funds to the selected campaign.
    //
    // TODO: add issuehunter "tip". The tip could be used to compute the issue
    // campaign's rank in the list. Higher tips will make campaigns more visible
    // in the directory, by making them appear with a higher rank in the list.
    function fund(bytes32 issueId) public payable {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        // TODO: require that a campaign hasn't any verified patch

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

    // Submit a new patch.
    //
    // This method is defined as payable because the sender must pay a patch
    // verification fee that will be used by the patch verifier, after the patch
    // has been verified, to inform the contract of the successful verification.
    function submitPatch(bytes32 issueId, bytes32 ref) public payable {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if sender already submitted the same patch
        require(campaigns[issueId].patches[msg.sender] == 0 || campaigns[issueId].patches[msg.sender] != ref);

        // TODO: require that a campaign hasn't any verified patch

        // TODO: require that a campaign has a positive reward amount (?) It
        // doesn't make a lot of sense to submit a patch for a campaign that
        // wouldn't give any reward, but maybe it's better to check anyway

        // Calculate fee amount based on the current transaction's gas price
        uint feeAmount = _patchVerificationFee(tx.gasprice);
        // Fail if the transaction value is less than the verification fee
        require(msg.value >= feeAmount);
        // Pay the patch verification fee
        campaigns[issueId].patchVerifier.transfer(msg.value);

        campaigns[issueId].patches[msg.sender] = ref;

        PatchSubmitted(issueId, msg.sender, ref);
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
    // the associated patch's ref don't match with the function arguments. This
    // will prevent concurrent updates of a patch submitted by the same author.
    function verifyPatch(bytes32 issueId, address author, bytes32 ref) public {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Only patch verifier is allowed to call this function
        require(msg.sender == campaigns[issueId].patchVerifier);
        // Fail if author didn't submit the selected patch
        require(campaigns[issueId].patches[author] == ref);
        // Fail if a patche has been already verified
        require(campaigns[issueId].resolvedBy == 0);

        campaigns[issueId].resolvedBy = author;
        campaigns[issueId].preRewardPeriodExpiresAt = now + preRewardPeriod;
        campaigns[issueId].rewardPeriodExpiresAt = campaigns[issueId].preRewardPeriodExpiresAt + rewardPeriod;
        campaigns[issueId].tipsAmount = campaigns[issueId].total - _reciprocalPerMille(campaigns[issueId].total, campaigns[issueId].tipPerMille);
        tipsAmount += campaigns[issueId].tipsAmount;

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
    function rollbackFunds(bytes32 issueId) public {
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
    function withdrawReward(bytes32 issueId) public {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);
        // Fail if all funds have been rolled back
        require(campaigns[issueId].total > 0);
        // A campaign can be rewarded only once
        require(!campaigns[issueId].rewarded);
        // Only the verified patch's author is allowed to withdraw the
        // campaign's reward
        require(msg.sender == campaigns[issueId].resolvedBy);
        // Withdraw can happen only within the execution period, that is after
        // reward period has expired and before execution period expires
        require(now > campaigns[issueId].preRewardPeriodExpiresAt);
        // TODO: remove this check (?), why prevent a verified patch's author to
        // withdraw a reward even after the `rewardPeriodExpiresAt` has passed?
        require(now <= campaigns[issueId].rewardPeriodExpiresAt);

        // Set campaign status as "rewarded"
        campaigns[issueId].rewarded = true;

        // Compute remaining withdrawable amount after tips
        uint rewardAmount = _reciprocalPerMille(campaigns[issueId].total, campaigns[issueId].tipPerMille);
        msg.sender.transfer(rewardAmount);

        WithdrawReward(issueId, msg.sender, rewardAmount);

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
    function withdrawSpareFunds(bytes32 issueId) public {
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

    // The default patch verifier, that is the contract owner, has the ability
    // to withdraw tips.
    //
    // Tips are calculated after a patch has been successfully verified. From
    // that moment on, tips are applied to all subsequent withdrawals from
    // campaign's funds (fund rollbacks, reward withdrawal, spare funds
    // withdrawals).
    //
    // TODO: it doesn't make a lot of sense that the default patch verifier is
    // used instead of the owner of the contract. Let's add a new contract
    // variable to store the contract's owner address.
    function withdrawTips() public {
        // msg.sender must be the contract's owner
        //
        // TODO: fix confusion between default patch verifier and contract's
        // owner
        require(msg.sender == defaultPatchVerifier);
        // Disallow `withdrawTips` if `tipsAmount` is zero
        require(tipsAmount > 0);

        uint amount = tipsAmount;
        // Reset contract's tips amount to zero
        tipsAmount = 0;
        // Transfer tips amount to contract's owner account
        msg.sender.transfer(amount);

        WithdrawTips(msg.sender, amount);
    }

    // TODO: add doc...
    function _rollbackFunds(Campaign storage campaign, address funder) internal returns (uint amount) {
        uint funds = campaign.funds[funder];
        require(funds > 0);

        campaign.funds[funder] = 0;
        campaign.total -= funds;
        // Compute remaining withdrawable amount after tips
        amount = _reciprocalPerMille(funds, campaign.tipPerMille);
        funder.transfer(amount);

        return amount;
    }

    // The patch verification fee amount is set to twice the amount of Ether
    // needed to send a transaction to execute the method `verifyPatch`
    // according the gas price in input. In theory this should be more than
    // enough for the verifier to run the transaction and to spare some gas.
    function _patchVerificationFee(uint gasprice) internal returns (uint) {
        return gasprice * verifyPatchEstimatedGas * 2;
    }

    // Return the reciprocal of the `tipPerMille` value applied to `amount`.
    //
    // The reciprocal is used, instead of a tip amount, because `uint` division
    // always truncates. This means that the amount of Ether returned by the
    // contract will be always less than or equal to the amount after the
    // calculation at a higher precision.
    //
    // TODO: review math
    function _reciprocalPerMille(uint amount, uint tipPerMille) internal returns (uint) {
        return amount * (1000 - tipPerMille) / 1000;
    }

    ////////////////////////////////////////////////////////////////////////////
    // Getters
    ////////////////////////////////////////////////////////////////////////////
    function campaignFunds(bytes32 issueId, address funder) public returns (uint amount) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].funds[funder];
    }

    function campaignResolutions(bytes32 issueId, address author) public returns (bytes32 ref) {
        // Require that a campaign exists
        require(campaigns[issueId].createdBy != 0);

        return campaigns[issueId].patches[author];
    }
}
