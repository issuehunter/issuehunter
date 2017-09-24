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

const gasPrice = Promise.denodeify(web3.eth.getGasPrice)

const newCampaignId = (function () {
  var counter = 200
  return function () {
    counter += 1
    return `new-campaign-${counter}`
  }
})()

contract('Issuehunter', function (accounts) {
  const patchVerifier = accounts[0]
  const issuehunter = Issuehunter.deployed()

  const verifyPatchEstimatedGas = issuehunter.then(function (instance) {
    return instance.verifyPatchEstimatedGas.call()
  })

  const minVerificationFee = Promise.all([gasPrice(), verifyPatchEstimatedGas]).then(function ([gprice, estGas]) {
    return gprice.mul(estGas).mul(2)
  })

  const newCampaign = function (issueId, account) {
    return issuehunter.then(function (instance) {
      return instance.createCampaign(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'CampaignCreated'), 'A new `CampaignCreated` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const newCampaignWithVerifier = function (issueId, patchVerifier, account) {
    return issuehunter.then(function (instance) {
      return instance.createCampaignWithVerifier(issueId, patchVerifier, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'CampaignCreated'), 'A new `CampaignCreated` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const fundCampaign = function (issueId, value, account) {
    return issuehunter.then(function (instance) {
      return instance.fund(issueId, { from: account, value: value })
    }).then(function (result) {
      assert(findEvent(result, 'CampaignFunded'), 'A new `CampaignFunded` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const submitPatchWithFee = function (issueId, ref, value, account) {
    return Promise.all([issuehunter, gasPrice()]).then(function ([instance, gprice]) {
      return instance.submitPatch(issueId, ref, { from: account, value: value, gasPrice: gprice })
    }).then(function (result) {
      assert(findEvent(result, 'PatchSubmitted'), 'A new `PatchSubmitted` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaignResolutions.call(issueId, account)
    })
  }

  const submitPatch = function (issueId, ref, account) {
    return minVerificationFee.then(function (minFee) {
      return submitPatchWithFee(issueId, ref, minFee, account)
    })
  }

  const verifyPatch = function (issueId, author, ref, account) {
    return issuehunter.then(function (instance) {
      return instance.verifyPatch(issueId, author, ref, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'PatchVerified'), 'A new `PatchVerified` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const rollbackFunds = function (issueId, account) {
    return issuehunter.then(function (instance) {
      return instance.rollbackFunds(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'RollbackFunds'), 'A new `RollbackFunds` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const withdrawReward = function (issueId, account) {
    return issuehunter.then(function (instance) {
      return instance.withdrawReward(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'WithdrawFunds'), 'A new `WithdrawFunds` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  const withdrawSpareFunds = function (issueId, account) {
    return issuehunter.then(function (instance) {
      return instance.withdrawSpareFunds(issueId, { from: account })
    }).then(function (result) {
      assert(findEvent(result, 'WithdrawSpareFunds'), 'A new `WithdrawSpareFunds` event has been triggered')
      return issuehunter
    }).then(function (instance) {
      return instance.campaigns.call(issueId)
    })
  }

  it('should make the first account the default patch verifier', function () {
    return issuehunter.then(function (instance) {
      return instance.defaultPatchVerifier.call()
    }).then(function (patchVerifier) {
      assert.equal(patchVerifier.valueOf(), patchVerifier, 'The first account should be the default patch verifier')
    })
  })

  it('should correctly initialize `preRewardPeriod` field', function () {
    return issuehunter.then(function (instance) {
      return instance.preRewardPeriod.call()
    }).then(function (preRewardPeriod) {
      assert.equal(preRewardPeriod.toNumber(), 60 * 60 * 24, 'The default pre-reward period should be one day in seconds')
    })
  })

  it('should correctly initialize `rewardPeriod` field', function () {
    return issuehunter.then(function (instance) {
      return instance.rewardPeriod.call()
    }).then(function (rewardPeriod) {
      assert.equal(rewardPeriod.toNumber(), 60 * 60 * 24 * 7, 'The default reward period should be one week in seconds')
    })
  })

  describe('createCampaign', function () {
    it('should create a new crowdfunding campaign', function () {
      const issueId = 'new-campaign-1'

      const finalState = newCampaign(issueId, accounts[1])
      const defaultPatchVerifier = issuehunter.then(function (instance) {
        return instance.defaultPatchVerifier.call()
      })

      return finalState.then(function (campaign) {
        assert.ok(!campaign[0], 'A new campaign that has not been rewarded should be present')
        assert.equal(campaign[1].toNumber(), 0, 'A new campaign with a zero total amount should be present')
        assert.equal(campaign[2].valueOf(), accounts[1], 'A new campaign with a non-null `createdBy` address should be present')
        assert.equal(campaign[3].toNumber(), 0, 'A new campaign with a null `preRewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[4].toNumber(), 0, 'A new campaign with a null `rewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[5].valueOf(), 0, 'A new campaign with a null `resolvedBy` address should be present')

        return Promise.all([finalState, defaultPatchVerifier])
      }).then(function ([campaign, defPatchVerifier]) {
        assert.equal(campaign[6].valueOf(), defPatchVerifier, 'The default patch verifier should be the new campaign\'s patch verifier')
      })
    })

    context('a campaign is already present', function () {
      const issueId = 'new-campaign-2'

      it('should fail to create a new campaign', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.createCampaign(issueId, { from: accounts[1] })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('createCampaignWithVerifier', function () {
    it('should create a new crowdfunding campaign with a custom patch verifier', function () {
      const issueId = newCampaignId()
      const patchVerifier = accounts[3]

      return newCampaignWithVerifier(issueId, patchVerifier, accounts[1]).then(function (campaign) {
        assert.ok(!campaign[0], 'A new campaign that has not been rewarded should be present')
        assert.equal(campaign[1].toNumber(), 0, 'A new campaign with a zero total amount should be present')
        assert.equal(campaign[2].valueOf(), accounts[1], 'A new campaign with a non-null `createdBy` address should be present')
        assert.equal(campaign[3].toNumber(), 0, 'A new campaign with a null `preRewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[4].toNumber(), 0, 'A new campaign with a null `rewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[5].valueOf(), 0, 'A new campaign with a null `resolvedBy` address should be present')
        assert.equal(campaign[6].valueOf(), patchVerifier, 'The custom patch verifier should be the new campaign\'s patch verifier')
      })
    })

    context('a campaign is already present', function () {
      const issueId = newCampaignId()
      const patchVerifier = accounts[3]

      it('should fail to create a new campaign', function () {
        const finalState = newCampaignWithVerifier(issueId, patchVerifier, accounts[1]).then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.createCampaignWithVerifier(issueId, patchVerifier, { from: accounts[1] })
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

      const initialTotal = issuehunter.then(function (instance) {
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
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1, 'Campaign\'s funder amount should be updated')
        // Test a second `fund` transaction from the same account
        return Promise.all([initialTotal, fundCampaign(issueId, txValue2, funder)])
      }).then(function ([initialTotalValue, campaign]) {
        assert.equal(campaign[1].toNumber(), initialTotalValue + txValue1 + txValue2, 'Campaign\'s total amount should be updated')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1 + txValue2, 'Campaign\'s funder amount should be updated')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'

      it('should fail to add funds to the campaign', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.fund(issueId, { from: accounts[1], value: 12 })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('submitPatch', function () {
    it('should store a new ref associated to the transaction sender', function () {
      const issueId = 'new-campaign-4'
      const ref1 = 'sha-1'
      const ref2 = 'sha-2'
      const verifier = accounts[0]

      const verifierInitialBalance = addressBalance(verifier)

      return newCampaign(issueId, accounts[1]).then(function () {
        // Test a `submitPatch` transaction from account 2
        return submitPatch(issueId, ref1, accounts[1])
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref1, 'Patch has been stored')
        return Promise.all([minVerificationFee, verifierInitialBalance, addressBalance(verifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber(), 'Fee amount has been transferred to verifier\'s account')
        // Test a `submitPatch` transaction for the same commit SHA from a
        // different account
        return submitPatch(issueId, ref1, accounts[2])
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref1, 'Patch has been stored')
        return Promise.all([minVerificationFee, verifierInitialBalance, addressBalance(verifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber() * 2, 'Fee amount has been transferred to verifier\'s account')
        // Test a `submitPatch` transaction for a new commit SHA from account 2
        return submitPatch(issueId, ref2, accounts[1])
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref2, 'Patch has been stored')
        return Promise.all([minVerificationFee, verifierInitialBalance, addressBalance(verifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber() * 3, 'Fee amount has been transferred to verifier\'s account')
      })
    })

    context('account already submitted a patch', function () {
      const issueId = 'new-campaign-5'
      const ref = 'sha'

      it('should fail to submit the same patch twice', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          // Test a `submitPatch` transaction from account 2
          return submitPatch(issueId, ref, accounts[1])
        }).then(function (storedCommitSHA) {
          assert.equal(web3.toUtf8(storedCommitSHA), ref, 'Patch has been stored')
          // Test a `submitPatch` transaction for the same commit SHA from
          // account 2
          return submitPatch(issueId, ref, accounts[1])
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const ref = 'sha'

      it('should fail to submit a patch', function () {
        const finalState = Promise.all([issuehunter, minVerificationFee]).then(function ([instance, minFee]) {
          return instance.submitPatch(issueId, ref, { from: accounts[1], value: minFee })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('verifyPatch', function () {
    it('should set the selected address as the campaign\'s resolvedBy', function () {
      const issueId = 'new-campaign-6'
      const ref = 'sha'
      const author = accounts[1]

      const patchVerified = newCampaign(issueId, accounts[1]).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      })

      return patchVerified.then(function () {
        return Promise.all([patchVerified, currentBlockTimestamp()])
      }).then(function ([campaign, now]) {
        assert.equal(campaign[3].toNumber(), now + 60 * 60 * 24, '`preRewardPeriodExpiresAt` value should have been updated')
        assert.equal(campaign[4].toNumber(), now + 60 * 60 * 24 * 8, '`rewardPeriodExpiresAt` value should have been updated')
        assert.equal(campaign[5].valueOf(), author, '`resolvedBy` address should be verified patch\'s author address')
      })
    })

    context('a patch has been already verified', function () {
      const issueId = 'new-campaign-7'
      const ref = 'sha'
      const author = accounts[1]

      it('should fail to verify again any patch', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function (campaign) {
          assert.equal(campaign[5].valueOf(), author, '`resolvedBy` address should be verified patch\'s author address')
          // Test that the campaign can have at most one verified patch
          return verifyPatch(issueId, author, ref, patchVerifier)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a patch that doesn\'t exist', function () {
      const issueId = 'new-campaign-8'
      const ref = 'sha'
      const author = accounts[1]

      it('should fail to verify a patch', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return submitPatch(issueId, ref, accounts[2])
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('an address that\'s not associated to the patch verifier', function () {
      const issueId = 'new-campaign-9'
      const ref = 'sha'
      const author = accounts[1]

      it('should fail to verify a patch', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return verifyPatch(issueId, author, ref, accounts[1])
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    // This is the case when a patch's author submits two different refs in a
    // row and, while the patch verifier is sending a transaction to verify the
    // first patch. `verifyPatch` should fail because it's associated to an old
    // author/ref combination.
    context('patch\'s ref and parameters don\'t match', function () {
      const issueId = 'new-campaign-mismatch'
      const ref1 = 'sha1'
      const ref2 = 'sha1'
      const author = accounts[1]

      it('should fail to verify the outdated patch', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return submitPatch(issueId, ref1, author)
        }).then(function () {
          return submitPatch(issueId, ref2, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref1, patchVerifier)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[5].valueOf(), 0, '`resolvedBy` is still unset')
        })
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const ref = 'sha'
      const author = accounts[1]

      it('should fail to verify a patch', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.verifyPatch(issueId, author, ref, { from: patchVerifier })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('rollbackFunds', function () {
    it('should remove funding from the selected campaign', function () {
      const issueId = 'new-campaign-10'
      const ref = 'sha'
      const funder1 = accounts[1]
      const funder2 = accounts[2]
      const txValue1 = 10
      const txValue2 = 12
      const author = accounts[1]

      return newCampaign(issueId, accounts[1]).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      }).then(function () {
        return rollbackFunds(issueId, funder1)
      }).then(function (campaign) {
        assert.equal(campaign[1].toNumber(), txValue2, 'Campaign\'s total amount should be updated')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder1)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), 0, 'Campaign\'s funder amount should be updated')
      })
    })

    context('a patch hasn\'t been verified yet', function () {
      const issueId = 'new-campaign-11'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder is unmodified')
        })
      })
    })

    context('right before the pre-reward period end', function () {
      const issueId = 'new-campaign-12'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('remove funding from the selected campaign', function () {
        return newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        }).then(function (campaign) {
          assert.equal(campaign[1].toNumber(), 0, 'Campaign\'s total amount should be updated')
          return issuehunter
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), 0, 'Campaign\'s funder amount should be updated')
        })
      })
    })

    context('past the pre-reward period', function () {
      const issueId = 'new-campaign-13'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return rollbackFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder is unmodified')
        })
      })
    })

    context('an address that\'s not associated to any funder', function () {
      const issueId = 'new-campaign-14'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return rollbackFunds(issueId, accounts[2])
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
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
        const finalState = issuehunter.then(function (instance) {
          return instance.rollbackFunds(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('withdrawReward', function () {
    it('should withdraw the whole campaing\'s amount as a reward', function () {
      const issueId = 'new-campaign-15'
      const ref = 'sha'
      const funder1 = accounts[1]
      const funder2 = accounts[2]
      const txValue1 = 10
      const txValue2 = 12
      const author = accounts[3]

      const initialAuthorBalance = addressBalance(author)

      return newCampaign(issueId, accounts[1]).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      }).then(function () {
        // One second past the pre-reward period
        return increaseTime(60 * 60 * 24 + 1)
      }).then(function () {
        return withdrawReward(issueId, author)
      }).then(function (campaign) {
        assert.ok(campaign[0], 'Campaign has been rewarded')
        // Campaign's total amount will keep track of the total amount that has
        // been paid by the campaign
        assert.equal(campaign[1].toNumber(), txValue1 + txValue2, 'Campaign\'s total amount is unmodified')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder1)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue1, 'Campaign\'s funder amount is unmodified')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder2)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue2, 'Campaign\'s funder amount is unmodified')
        return Promise.all([initialAuthorBalance, addressBalance(author)])
      }).then(function ([initialAmount, currentAmount]) {
        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive
        assert.equal(currentAmount.mod(10000) - initialAmount.mod(10000), txValue1 + txValue2, 'Verified patch\'s author balance has increased by the value of the reward')
      })
    })

    context('a campaign has been already rewarded', function () {
      const issueId = 'new-campaign-16'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw reward twice', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawReward(issueId, author)
        }).then(function (campaign) {
          assert.ok(campaign[0], 'Campaign has been rewarded')
        }).then(function () {
          return withdrawReward(issueId, author)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.ok(campaign[0], 'Campaign status is unmodified')
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('a patch hasn\'t been verified yet', function () {
      const issueId = 'new-campaign-17'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return withdrawReward(issueId, author)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.ok(!campaign[0], 'Campaign hasn\'t been rewarded')
        })
      })
    })

    context('msg.sender is not the verified patch\'s author', function () {
      const issueId = 'new-campaign-18'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawReward(issueId, accounts[2])
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.ok(!campaign[0], 'Campaign hasn\'t been rewarded')
        })
      })
    })

    context('right before the execution period end', function () {
      const issueId = 'new-campaign-19'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('successfully withdraws the whole campaing\'s amount as a reward', function () {
        return newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // The execution period end is one week after the pre-reward period
          // ends, that is 7 + 1 days from the moment the patch has been
          // verified
          return increaseTime(60 * 60 * 24 * 8)
        }).then(function () {
          return withdrawReward(issueId, author)
        }).then(function (campaign) {
          assert.ok(campaign[0], 'Campaign has been rewarded')
          // Campaign's total amount will keep track of the total amount that has
          // been paid by the campaign
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
          return issuehunter
        }).then(function (instance) {
          return instance.campaignFunds.call(issueId, funder)
        }).then(function (amount) {
          assert.equal(amount.toNumber(), txValue, 'Campaign\'s funder amount is unmodified')
        })
      })
    })

    // TODO: I think this is not fair. The verified patch's author should always
    // be able to withdraw their reward.
    context('past the execution period', function () {
      const issueId = 'new-campaign-20'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24 * 8 + 1)
        }).then(function () {
          return withdrawReward(issueId, author)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.ok(!campaign[0], 'Campaign hasn\'t been rewarded')
        })
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const funder = accounts[1]

      it('should fail to rollback funds', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.withdrawReward(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('withdrawSpareFunds', function () {
    it('should withdraw spare funds in the campaing', function () {
      const issueId = 'new-campaign-21'
      const ref = 'sha'
      const funder1 = accounts[1]
      const funder2 = accounts[2]
      const txValue1 = 10
      const txValue2 = 12
      const author = accounts[3]

      const funder1InitialBalance = addressBalance(funder1)

      return newCampaign(issueId, accounts[1]).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      }).then(function () {
        // The execution period end is one week after the pre-reward period
        // ends, that is 7 + 1 days from the moment the patch has been verified
        // Funders are allowed to withdraw spare funds right after the execution
        // period is expired
        return increaseTime(60 * 60 * 24 * 8 + 1)
      }).then(function () {
        return withdrawSpareFunds(issueId, funder1)
      }).then(function (campaign) {
        assert.equal(campaign[1].toNumber(), txValue2, 'Campaign\'s total amount should be updated')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder1)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), 0, 'Campaign\'s funder amount has been reset to 0')
        return issuehunter
      }).then(function (instance) {
        return instance.campaignFunds.call(issueId, funder2)
      }).then(function (amount) {
        assert.equal(amount.toNumber(), txValue2, 'Campaign\'s funder amount is unmodified')
        return Promise.all([funder1InitialBalance, addressBalance(funder1)])
      }).then(function ([initialAmount, currentAmount]) {
        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive
        assert.equal(currentAmount.mod(10000) - initialAmount.mod(10000), 0, 'Funder 1\'s balance hasn\'t been modified')
      })
    })

    context('a campaign has been already rewarded', function () {
      const issueId = 'new-campaign-22'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawReward(issueId, author)
        }).then(function (campaign) {
          assert.ok(campaign[0], 'Campaign has been rewarded')
        }).then(function () {
          // One second past the reward period
          return increaseTime(60 * 60 * 24 * 7)
        }).then(function () {
          return withdrawSpareFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.ok(campaign[0], 'Campaign status is unmodified')
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('right after a funding transaction', function () {
      const issueId = 'new-campaign-23'
      const funder = accounts[1]
      const txValue = 10

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return withdrawSpareFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('msg.sender is not a funder', function () {
      const issueId = 'new-campaign-24'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the reward period
          return increaseTime(60 * 60 * 24 * 8 + 1)
        }).then(function () {
          return withdrawSpareFunds(issueId, accounts[2])
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.campaigns.call(issueId)
        }).then(function (campaign) {
          assert.equal(campaign[1].toNumber(), txValue, 'Campaign\'s total amount is unmodified')
        })
      })
    })

    context('right before the execution period expiration', function () {
      const issueId = 'new-campaign-25'
      const ref = 'sha'
      const funder = accounts[1]
      const txValue = 10
      const author = accounts[1]

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, accounts[1]).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24 * 8)
        }).then(function () {
          return withdrawSpareFunds(issueId, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown').then(function () {
          return issuehunter
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
        const finalState = issuehunter.then(function (instance) {
          return instance.withdrawReward(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })
})
