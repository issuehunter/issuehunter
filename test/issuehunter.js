const Promise = require('promise')

const Issuehunter = artifacts.require('./Issuehunter.sol')

const ethRPCSendAsync = Promise.denodeify(web3.currentProvider.sendAsync)

// Returns true if `eventName` is present in `transactionResult`'s logs list.
const findEvent = function (transactionResult, eventName) {
  for (var i = 0; i < transactionResult.logs.length; i++) {
    if (transactionResult.logs[i].event === eventName) {
      return true
    }
  }

  return false
}

// Assertion helper to test contract exceptions.
const assertContractException = function (promise, message) {
  return promise.then(function () {
    assert.fail(message, 'Exception missing')
  }).catch(function (err) {
    if (err.toString().indexOf('invalid opcode') > -1) {
      assert(true, message)
    } else {
      console.error('Transation exception', err)
      assert.fail(message, `Unexpected exception: ${err}`)
    }
  })
}

const increaseTime = function (addSeconds) {
  // Increase time
  return ethRPCSendAsync({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [addSeconds],
    id: 0
  }).then(function () {
    // Force a new block to be mined
    return ethRPCSendAsync({
      jsonrpc: '2.0',
      method: 'evm_mine',
      params: [],
      id: 0
    })
  })
}

const currentBlockTimestamp = function () {
  return ethRPCSendAsync({
    jsonrpc: '2.0',
    method: 'eth_blockNumber',
    params: [],
    id: 0
  }).then(function (res) {
    return ethRPCSendAsync({
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: [res.result, false],
      id: 0
    })
  }).then(function (res) {
    return web3.toDecimal(res.result.timestamp)
  })
}

const addressBalance = Promise.denodeify(function (address, callback) {
  web3.eth.getBalance(address, web3.eth.defaultBlock, callback)
})

contract('Issuehunter', function (accounts) {
  const issueManager = accounts[0]

  const newCampaign = function (issueId, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.createCampaign(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'CampaignCreated'), 'A new `CampaignCreated` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const fundCampaign = function (issueId, value, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.fund(issueId, { from: account, value: value })
    }).then(function (result) {
      assert(findEvent(result, 'CampaignFunded'), 'A new `CampaignFunded` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const submitResolution = function (issueId, commitSHA, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.submitResolution(issueId, commitSHA, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'ResolutionProposed'), 'A new `ResolutionProposed` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaignResolutions.call(issueId, account)
    })
  }

  const verifyResolution = function (issueId, resolutor, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.verifyResolution(issueId, resolutor, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'ResolutionVerified'), 'A new `ResolutionVerified` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const rollbackFunds = function (issueId, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.rollbackFunds(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'RollbackFunds'), 'A new `RollbackFunds` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const withdrawFunds = function (issueId, account) {
    return Issuehunter.deployed().then(function (instance) {
      return instance.withdrawFunds(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'WithdrawFunds'), 'A new `WithdrawFunds` event has been triggered')
      return Issuehunter.deployed()
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  it('should make the first account the issue manager', function () {
    return Issuehunter.deployed().then(function (instance) {
      return instance.issueManager.call()
    }).then(function (issueManager) {
      assert.equal(issueManager.valueOf(), issueManager, 'The first account should be the issue manager')
    })
  })

  it('should correctly initialize `defaultRewardPeriod` field', function () {
    return Issuehunter.deployed().then(function (instance) {
      return instance.defaultRewardPeriod.call()
    }).then(function (defaultRewardPeriod) {
      assert.equal(defaultRewardPeriod.toNumber(), 60 * 60 * 24, 'The default reward period should be one day in seconds')
    })
  })

  it('should correctly initialize `defaultExecutePeriod` field', function () {
    return Issuehunter.deployed().then(function (instance) {
      return instance.defaultExecutePeriod.call()
    }).then(function (defaultExecutePeriod) {
      assert.equal(defaultExecutePeriod.toNumber(), 60 * 60 * 24 * 7, 'The default execute period should be one week in seconds')
    })
  })

  describe('createCampaign', function () {
    it('should create a new crowdfunding campaign', function () {
      const issueId = 'new-campaign-1'

      return newCampaign(issueId, accounts[1]).then(function (campaign) {
        assert.equal(campaign[0], false, 'A new campaign that has not been executed should be present')
        assert.equal(campaign[1].toNumber(), 0, 'A new campaign with a zero total amount should be present')
        assert.equal(campaign[2].valueOf(), accounts[1], 'A new campaign with a non-null `createdBy` address should be present')
        assert.equal(campaign[3].toNumber(), 0, 'A new campaign with a null `rewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[4].toNumber(), 0, 'A new campaign with a null `executePeriodExpiresAt` value should be present')
        assert.equal(campaign[5].valueOf(), 0, 'A new campaign with a null `resolutor` address should be present')
      })
    })

    context('a campaign is already present', function () {
      const issueId = 'new-campaign-2'

      it('should fail to create a new campaign', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.createCampaign(issueId, { from: accounts[1] })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('fund', function () {
    it('should add funds to the campaign', function () {
      const issueId = 'new-campaign-3'
      const funder = accounts[1]
      const txValue1 = 12
      const txValue2 = 24

      const initialTotal = Issuehunter.deployed().then(function (instance) {
        return instance.campaigns.call(issueId)
      }).then(function (campaign) {
        return campaign[1].toNumber()
      })

      return newCampaign(issueId, accounts[1]).then(function () {
        return initialTotal
      }).then(function () {
        // Test a `fund` transaction from `funder`
        return Promise.all([initialTotal, fundCampaign(issueId, txValue1, funder)])
      }).then(function ([initialTotalValue, campaign]) {
        assert.equal(campaign[1].toNumber(), initialTotalValue + txValue1, 'Campaign\'s total amount should be updated')
        return Issuehunter.deployed()
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1, 'Campaign\'s funder amount should be updated')
        // Test a second `fund` transaction from the same account
        return Promise.all([initialTotal, fundCampaign(issueId, txValue2, funder)])
      }).then(function ([initialTotalValue, campaign]) {
        assert.equal(campaign[1].toNumber(), initialTotalValue + txValue1 + txValue2, 'Campaign\'s total amount should be updated')
        return Issuehunter.deployed()
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1 + txValue2, 'Campaign\'s funder amount should be updated')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'

      it('should fail to add funds to the campaign', function () {
        const finalState = Issuehunter.deployed().then(function (instance) {
          return instance.fund(issueId, { from: accounts[1], value: 12 })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('submitResolution', function () {
    it('should store a new commit associated to the transaction sender', function () {
      const issueId = 'new-campaign-4'
      const commitSHA1 = 'sha-1'
      const commitSHA2 = 'sha-2'

      return newCampaign(issueId, accounts[1]).then(function () {
        // Test a `submitResolution` transaction from account 2
        return submitResolution(issueId, commitSHA1, accounts[1])
      }).then(function (proposedCommitSHA) {
        assert.equal(web3.toUtf8(proposedCommitSHA), commitSHA1, 'Proposed resolution has been stored')
        // Test a `submitResolution` transaction for the same commit SHA from a different account
        return submitResolution(issueId, commitSHA1, accounts[2])
      }).then(function (proposedCommitSHA) {
        assert.equal(web3.toUtf8(proposedCommitSHA), commitSHA1, 'Proposed resolution has been stored')
        // Test a `submitResolution` transaction for a new commit SHA from account 2
        return submitResolution(issueId, commitSHA2, accounts[1])
      }).then(function (proposedCommitSHA) {
        assert.equal(web3.toUtf8(proposedCommitSHA), commitSHA2, 'Proposed resolution has been stored')
      })
    })

    context('account already proposed a resolution', function () {
      const issueId = 'new-campaign-5'
      const commitSHA = 'sha'

      it('should fail to submit the same proposed resolution twice', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          // Test a `submitResolution` transaction from account 2
          return submitResolution(issueId, commitSHA, accounts[1])
        }).then(function (proposedCommitSHA) {
          assert.equal(web3.toUtf8(proposedCommitSHA), commitSHA, 'Proposed resolution has been stored')
          // Test a `submitResolution` transaction for the same commit SHA from account 2
          return submitResolution(issueId, commitSHA, accounts[1])
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const commitSHA = 'sha'

      it('should fail to submit a proposed resolution', function () {
        const finalState = Issuehunter.deployed().then(function (instance) {
          return instance.submitResolution(issueId, commitSHA, { from: accounts[1] })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('verifyResolution', function () {
    it('should set the selected address as the issue resolutor', function () {
      const issueId = 'new-campaign-6'
      const commitSHA = 'sha'
      const resolutor = accounts[1]

      const resolutionVerified = newCampaign(issueId, accounts[1]).then(function () {
        return submitResolution(issueId, commitSHA, resolutor)
      }).then(function () {
        return verifyResolution(issueId, resolutor, issueManager)
      })

      return resolutionVerified.then(function () {
        return Promise.all([resolutionVerified, currentBlockTimestamp()])
      }).then(function ([campaign, now]) {
        assert.equal(campaign[3].toNumber(), now + 60 * 60 * 24, '`rewardPeriodExpiresAt` value should have been updated')
        assert.equal(campaign[4].toNumber(), now + 60 * 60 * 24 * 8, '`executePeriodExpiresAt` value should have been updated')
        assert.equal(campaign[5].valueOf(), resolutor, '`resolutor` address should be resolutor\'s address')
      })
    })

    context('a resolution has been already verified', function () {
      const issueId = 'new-campaign-7'
      const commitSHA = 'sha'
      const resolutor = accounts[1]

      it('should fail to verify again any resolution', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function (campaign) {
          assert.equal(campaign[5].valueOf(), resolutor, '`resolutor` address should be resolutor\'s address')
          // Test that the campaign can have just one resolution
          return verifyResolution(issueId, resolutor, issueManager)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a resolution that doesn\'t exist', function () {
      const issueId = 'new-campaign-8'
      const commitSHA = 'sha'
      const resolutor = accounts[1]

      it('should fail to verify a proposed resolution', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return submitResolution(issueId, commitSHA, accounts[2])
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('an address that\'s not associated to the issue manager', function () {
      const issueId = 'new-campaign-9'
      const resolutor = accounts[1]

      it('should fail to verify a proposed resolution', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return verifyResolution(issueId, resolutor, accounts[1])
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const resolutor = accounts[1]

      it('should fail to verify a proposed resolution', function () {
        const finalState = Issuehunter.deployed().then(function (instance) {
          return instance.verifyResolution(issueId, resolutor, { from: issueManager })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('rollbackFunds', function () {
    it('should remove funding from the selected campaign', function () {
      const issueId = 'new-campaign-10'
      const commitSHA = 'sha'
      const funder1 = accounts[1]
      const funder2 = accounts[2]
      const txValue1 = 10
      const txValue2 = 12
      const resolutor = accounts[1]

      return newCampaign(issueId, accounts[1]).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitResolution(issueId, commitSHA, resolutor)
      }).then(function () {
        return verifyResolution(issueId, resolutor, issueManager)
      }).then(function () {
        return rollbackFunds(issueId, funder1)
      }).then(function (campaign) {
        assert.equal(campaign[1].toNumber(), txValue2, 'Campaign\'s total amount should be updated')
        return Issuehunter.deployed()
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder1)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), 0, 'Campaign\'s funder amount should be updated')
      })
    })

    context('a resolution hasn\'t been verified yet', function () {
      const issueId = 'new-campaign-11'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder is unmodified')
        })
      })
    })

    context('right before the reward period end', function () {
      const issueId = 'new-campaign-12'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('remove funding from the selected campaign', function () {
        return newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          return increaseTime(60 * 60 * 24)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        }).then(function (campaign) {
          assert.equal(campaign[1].toNumber(), 0, 'Campaign\'s total amount should be updated')
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), 0, 'Campaign\'s funder amount should be updated')
        })
      })
    })

    context('past the reward period', function () {
      const issueId = 'new-campaign-13'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder is unmodified')
        })
      })
    })

    context('an address that\'s not associated to any funder', function () {
      const issueId = 'new-campaign-14'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          return rollbackFunds(issueId, accounts[2])
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const funder = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = Issuehunter.deployed().then(function (instance) {
          return instance.rollbackFunds(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('withdrawFunds', function () {
    it('should withdraw the whole campaing\'s amount as a reward', function () {
      const issueId = 'new-campaign-15'
      const commitSHA = 'sha'
      const funder1 = accounts[1]
      const funder2 = accounts[2]
      const txValue1 = 10
      const txValue2 = 12
      const resolutor = accounts[3]

      const initialResolutorBalance = addressBalance(resolutor)

      return newCampaign(issueId, accounts[1]).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitResolution(issueId, commitSHA, resolutor)
      }).then(function () {
        return verifyResolution(issueId, resolutor, issueManager)
      }).then(function () {
        // One second past the pre-reward period
        return increaseTime(60 * 60 * 24 + 1)
      }).then(function () {
        return withdrawFunds(issueId, resolutor)
      }).then(function (campaign) {
        assert.equal(campaign[0], true, 'Campaign has been executed')
        // Campaign's total amount will keep track of the total amount that has
        // been paid by the campaign
        assert.equal(campaign[1].toNumber(), txValue1 + txValue2, 'Campaign\'s total amount is unmodified')
        return Issuehunter.deployed()
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder1)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1, 'Campaign\'s funder amount is unmodified')
        return Issuehunter.deployed()
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder2)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue2, 'Campaign\'s funder amount is unmodified')
        return Promise.all([initialResolutorBalance, addressBalance(resolutor)])
      }).then(function ([initialAmount, currentAmount]) {
        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive
        assert.equal(currentAmount.mod(10000) - initialAmount.mod(10000), txValue1 + txValue2, 'Resolutor\'s balance has increased by the value of the reward')
      })
    })

    context('a campaign has been already executed', function () {
      const issueId = 'new-campaign-16'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to withdraw funds twice', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawFunds(issueId, resolutor)
        }).then(function (campaign) {
          assert.equal(campaign[0], true, 'Campaign has been executed')
        }).then(function () {
          return withdrawFunds(issueId, resolutor)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[0], true, 'Campaign status is unmodified')
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('a resolution hasn\'t been verified yet', function () {
      const issueId = 'new-campaign-17'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to withdraw funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return withdrawFunds(issueId, resolutor)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[0], false, 'Campaign hasn\'t been executed')
        })
      })
    })

    context('msg.sender is not the issue resolutor', function () {
      const issueId = 'new-campaign-18'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to withdraw funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawFunds(issueId, accounts[2])
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[0], false, 'Campaign hasn\'t been executed')
        })
      })
    })

    context('right before the execution period end', function () {
      const issueId = 'new-campaign-19'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('successfully withdraws the whole campaing\'s amount as a reward', function () {
        return newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          // The execution period end is one week after the reward period end,
          // that is 7 + 1 days from the moment the resolution has been verified
          return increaseTime(60 * 60 * 24 * 8)
        }).then(function () {
          return withdrawFunds(issueId, resolutor)
        }).then(function (campaign) {
          assert.equal(campaign[0], true, 'Campaign has been executed')
          // Campaign's total amount will keep track of the total amount that has
          // been paid by the campaign
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder amount is unmodified')
        })
      })
    })

    // TODO: I think this is not fair. The author of the issue's resolution
    // should always been able to withdraw their reward.
    context('past the execution period', function () {
      const issueId = 'new-campaign-20'
      const commitSHA = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const resolutor = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitResolution(issueId, commitSHA, resolutor)
        }).then(function () {
          return verifyResolution(issueId, resolutor, issueManager)
        }).then(function () {
          return increaseTime(60 * 60 * 24 * 8 + 1)
        }).then(function () {
          return withdrawFunds(issueId, resolutor)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return Issuehunter.deployed()
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[0], false, 'Campaign hasn\'t been executed')
        })
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const funder = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = Issuehunter.deployed().then(function (instance) {
          return instance.withdrawFunds(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })
})
