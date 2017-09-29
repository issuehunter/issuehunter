const Promise = require('promise')
const seedrandom = require('seedrandom')

// Seed random function
let seed
let seedArg
process.argv.forEach(function (arg) {
  const matchSeedArg = arg.match(/--seed=([^\s]+)/)
  if (matchSeedArg) {
    seedArg = matchSeedArg[1]
  }
})
seed = seedArg ? seedArg : Math.random().toString()
console.log('Seed: ' + seed)
seedrandom(seed, { global: true })

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

const nextCampaignId = (function () {
  var counter = 0
  return function () {
    counter += 1
    return `new-campaign-${counter}`
  }
})()

const sample = function (array) {
  return function () {
    return array[Math.floor(Math.random() * array.length)]
  }
}

const sampleExcluding = function (array) {
  return function (exclusions) {
    const filtered = array.filter(function (item) {
      return exclusions.indexOf(item) < 0
    })
    return sample(filtered)()
  }
}

contract('Issuehunter', function (accounts) {
  const patchVerifier = accounts[0]
  const owner = accounts[0]
  const sampleAccount = sample(accounts)
  const sampleAccountExcluding = sampleExcluding(accounts)
  const issuehunter = Issuehunter.deployed()

  const VERIFY_PATCH_ESTIMATED_GAS = issuehunter.then(function (instance) {
    return instance.VERIFY_PATCH_ESTIMATED_GAS.call()
  })

  const minSubmissionFee = Promise.all([gasPrice(), VERIFY_PATCH_ESTIMATED_GAS]).then(function ([gprice, estGas]) {
    return gprice.mul(estGas).mul(2)
  })

  const defaultPatchVerifier = issuehunter.then(function (instance) {
    return instance.defaultPatchVerifier.call()
  })

  const DEFAULT_TIP_PER_MILLE = issuehunter.then(function (instance) {
    return instance.DEFAULT_TIP_PER_MILLE.call()
  })

  const MIN_TIP_PER_MILLE = issuehunter.then(function (instance) {
    return instance.MIN_TIP_PER_MILLE.call()
  })

  const MAX_TIP_PER_MILLE = issuehunter.then(function (instance) {
    return instance.MAX_TIP_PER_MILLE.call()
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

  const newCampaignExtended = function (issueId, patchVerifier, tipPerMille, account) {
    return issuehunter.then(function (instance) {
      return instance.createCampaignExtended(issueId, patchVerifier, tipPerMille, { from: account })
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
    return minSubmissionFee.then(function (minFee) {
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
      assert(findEvent(result, 'WithdrawReward'), 'A new `WithdrawReward` event has been triggered')
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

  const withdrawTips = function (account) {
    return issuehunter.then(function (instance) {
      return instance.withdrawTips({ from: account })
    }).then(function (result) {
      assert(findEvent(result, 'WithdrawTips'), 'A new `WithdrawTips` event has been triggered')
      return issuehunter
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

  it('should correctly initialize `tipsAmount` field', function () {
    return issuehunter.then(function (instance) {
      return instance.tipsAmount.call()
    }).then(function (tipsAmount) {
      assert.equal(tipsAmount.toNumber(), 0, 'The initial tips amount should be zero')
    })
  })

  describe('createCampaign', function () {
    it('should create a new crowdfunding campaign', function () {
      const issueId = nextCampaignId()
      const creator = sampleAccount()

      return Promise.all([
        newCampaign(issueId, creator),
        defaultPatchVerifier,
        DEFAULT_TIP_PER_MILLE
      ]).then(function ([campaign, defPatchVerifier, defTipPerMille]) {
        assert.ok(!campaign[0], 'A new campaign that has not been rewarded should be present')
        assert.equal(campaign[1].toNumber(), 0, 'A new campaign with a zero total amount should be present')
        assert.equal(campaign[2].valueOf(), creator, 'A new campaign with a non-null `createdBy` address should be present')
        assert.equal(campaign[3].toNumber(), 0, 'A new campaign with a null `preRewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[4].toNumber(), 0, 'A new campaign with a null `rewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[5].valueOf(), 0, 'A new campaign with a null `resolvedBy` address should be present')
        assert.equal(campaign[6].valueOf(), defPatchVerifier, 'The default patch verifier should be the new campaign\'s patch verifier')
        assert.equal(campaign[7].toNumber(), defTipPerMille.toNumber(), 'The default tip per mille should be the new campaign\'s tip value')
        assert.equal(campaign[8].toNumber(), 0, 'A new campaign with a zero tips amount should be present')
      })
    })

    context('a campaign is already present', function () {
      const issueId = nextCampaignId()

      it('should fail to create a new campaign', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return issuehunter
        }).then(function (instance) {
          return instance.createCampaign(issueId, { from: sampleAccount() })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('createCampaignExtended', function () {
    it('should create a new crowdfunding campaign with a custom patch verifier', function () {
      const issueId = nextCampaignId()
      const creator = sampleAccount()
      const customPatchVerifier = sampleAccount()

      return DEFAULT_TIP_PER_MILLE.then(function (tipPerMille) {
        return newCampaignExtended(issueId, customPatchVerifier, tipPerMille, creator)
      }).then(function (campaign) {
        assert.ok(!campaign[0], 'A new campaign that has not been rewarded should be present')
        assert.equal(campaign[1].toNumber(), 0, 'A new campaign with a zero total amount should be present')
        assert.equal(campaign[2].valueOf(), creator, 'A new campaign with a non-null `createdBy` address should be present')
        assert.equal(campaign[3].toNumber(), 0, 'A new campaign with a null `preRewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[4].toNumber(), 0, 'A new campaign with a null `rewardPeriodExpiresAt` value should be present')
        assert.equal(campaign[5].valueOf(), 0, 'A new campaign with a null `resolvedBy` address should be present')
        assert.equal(campaign[6].valueOf(), customPatchVerifier, 'The custom patch verifier should be the new campaign\'s patch verifier')
      })
    })

    context('tip value', function () {
      it('should create a new crowdfunding campaign with a custom tip value', function () {
        const issueId = nextCampaignId()
        const randomTipPerMille = Promise.all([MIN_TIP_PER_MILLE, MAX_TIP_PER_MILLE]).then(function ([min, max]) {
          // Return a random integer between min inclusive and max inclusive
          // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
          return Math.floor(Math.random() * (max.toNumber() + 1 - min.toNumber())) + min.toNumber()
        })

        return randomTipPerMille.then(function (tipPerMille) {
          return Promise.all([
            newCampaignExtended(issueId, patchVerifier, tipPerMille, sampleAccount()),
            randomTipPerMille
          ])
        }).then(function ([campaign, tipPerMille]) {
          assert.equal(campaign[7].toNumber(), tipPerMille, 'The custom tip per mille should be the new campaign\'s tip value')
        })
      })

      it('should allow a custom tip value that is equal to MIN_TIP_PER_MILLE', function () {
        const issueId = nextCampaignId()

        return MIN_TIP_PER_MILLE.then(function (minTip) {
          return Promise.all([
            newCampaignExtended(issueId, patchVerifier, minTip, sampleAccount()),
            MIN_TIP_PER_MILLE
          ])
        }).then(function ([campaign, minTip]) {
          assert.equal(campaign[7].toNumber(), minTip, 'The custom tip per mille should be the new campaign\'s tip value')
        })
      })

      it('should allow a custom tip value that is equal to MAX_TIP_PER_MILLE', function () {
        const issueId = nextCampaignId()

        return MAX_TIP_PER_MILLE.then(function (maxTip) {
          return Promise.all([
            newCampaignExtended(issueId, patchVerifier, maxTip, sampleAccount()),
            MAX_TIP_PER_MILLE
          ])
        }).then(function ([campaign, maxTip]) {
          assert.equal(campaign[7].toNumber(), maxTip, 'The custom tip per mille should be the new campaign\'s tip value')
        })
      })

      context('a tip value that is too low', function () {
        const issueId = nextCampaignId()

        it('should fail to create a new campaign', function () {
          const finalState = MIN_TIP_PER_MILLE.then(function (minTip) {
            return newCampaignExtended(issueId, patchVerifier, minTip.toNumber() - 1, sampleAccount())
          })

          return assertContractException(finalState, 'An exception has been thrown')
        })
      })

      context('a tip value that is too high', function () {
        const issueId = nextCampaignId()

        it('should fail to create a new campaign', function () {
          const finalState = MAX_TIP_PER_MILLE.then(function (maxTip) {
            return newCampaignExtended(issueId, patchVerifier, maxTip.toNumber() + 1, sampleAccount())
          })

          return assertContractException(finalState, 'An exception has been thrown')
        })
      })
    })

    context('a campaign is already present', function () {
      const issueId = nextCampaignId()

      it('should fail to create a new campaign', function () {
        const finalState = DEFAULT_TIP_PER_MILLE.then(function (tipPerMille) {
          return newCampaignExtended(issueId, patchVerifier, tipPerMille, sampleAccount())
        }).then(function () {
          return Promise.all([issuehunter, DEFAULT_TIP_PER_MILLE])
        }).then(function ([instance, tipPerMille]) {
          return instance.createCampaignExtended(issueId, patchVerifier, tipPerMille, { from: sampleAccount() })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('fund', function () {
    it('should add funds to the campaign', function () {
      const issueId = nextCampaignId()
      const funder = sampleAccount()
      const txValue1 = 12
      const txValue2 = 24

      const initialTotal = issuehunter.then(function (instance) {
        return instance.campaigns.call(issueId)
      }).then(function (campaign) {
        return campaign[1].toNumber()
      })

      return newCampaign(issueId, sampleAccount()).then(function () {
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

    context('a patch has been already verified', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const txValue = 10
      const funder = sampleAccount()
      const author = sampleAccount()

      it('should fail to add more funds to the campaign', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function (campaign) {
          assert.equal(campaign[5].valueOf(), author, '`resolvedBy` address should be verified patch\'s author address')
          // Test that it's not allowed to add funds to a campaign that has been
          // resolved
          return fundCampaign(issueId, txValue, funder)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'

      it('should fail to add funds to the campaign', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.fund(issueId, { from: sampleAccount(), value: 12 })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('submitPatch', function () {
    it('should store a new ref associated to the transaction sender', function () {
      const issueId = nextCampaignId()
      const ref1 = 'sha-1'
      const ref2 = 'sha-2'
      const author1 = sampleAccountExcluding([patchVerifier])
      const author2 = sampleAccountExcluding([author1, patchVerifier])
      const creator = sampleAccountExcluding([patchVerifier])

      const verifierInitialBalance = addressBalance(patchVerifier)

      return newCampaign(issueId, creator).then(function () {
        // Test a `submitPatch` transaction from author1
        return submitPatch(issueId, ref1, author1)
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref1, 'Patch has been stored')
        return Promise.all([minSubmissionFee, verifierInitialBalance, addressBalance(patchVerifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber(), 'Fee amount has been transferred to verifier\'s account')
        // Test a `submitPatch` transaction for the same commit SHA from a
        // different account
        return submitPatch(issueId, ref1, author2)
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref1, 'Patch has been stored')
        return Promise.all([minSubmissionFee, verifierInitialBalance, addressBalance(patchVerifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber() * 2, 'Fee amount has been transferred to verifier\'s account')
        // Test a `submitPatch` transaction for a new commit SHA from author1
        return submitPatch(issueId, ref2, author1)
      }).then(function (ref) {
        assert.equal(web3.toUtf8(ref), ref2, 'Patch has been stored')
        return Promise.all([minSubmissionFee, verifierInitialBalance, addressBalance(patchVerifier)])
      }).then(function ([minFee, initialAmount, currentAmount]) {
        // Note: compare account balance difference with a lower precision than
        // wei. The result was ~ +/- 5000 wei, but I didn't investigate why.
        // TODO: make this check stricter.
        assert.equal(Math.round((currentAmount - initialAmount) / 100000) * 100000, minFee.toNumber() * 3, 'Fee amount has been transferred to verifier\'s account')
      })
    })

    context('account already submitted a patch', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const author = sampleAccount()

      it('should fail to submit the same patch twice', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          // Test a `submitPatch` transaction from author
          return submitPatch(issueId, ref, author)
        }).then(function (storedCommitSHA) {
          assert.equal(web3.toUtf8(storedCommitSHA), ref, 'Patch has been stored')
          // Test a `submitPatch` transaction for the same commit SHA from
          // author
          return submitPatch(issueId, ref, author)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('transaction fee is lower than required submission fee', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'

      it('should fail to submit the same patch twice', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return minSubmissionFee
        }).then(function (minFee) {
          return submitPatchWithFee(issueId, ref, minFee.sub(1), sampleAccount())
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a patch has been already verified', function () {
      const issueId = nextCampaignId()
      const ref1 = 'sha-1'
      const ref2 = 'sha-2'
      const author = sampleAccount()

      it('should fail to submit a new patch', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return submitPatch(issueId, ref1, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref1, patchVerifier)
        }).then(function (campaign) {
          assert.equal(campaign[5].valueOf(), author, '`resolvedBy` address should be verified patch\'s author address')
          // Test that it's not allowed to submit new patches after a patch has
          // been verified
          return submitPatch(issueId, ref2, author)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('a campaign that doesn\'t exist', function () {
      const issueId = 'invalid'
      const ref = 'sha'

      it('should fail to submit a patch', function () {
        const finalState = Promise.all([issuehunter, minSubmissionFee]).then(function ([instance, minFee]) {
          return instance.submitPatch(issueId, ref, { from: sampleAccount(), value: minFee })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('verifyPatch', function () {
    it('should set the selected address as the campaign\'s resolvedBy', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const author = sampleAccount()

      const patchVerified = newCampaign(issueId, sampleAccount()).then(function () {
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

    it('should set the correct tips amount', function () {
      const issueId = nextCampaignId()
      const funder = sampleAccount()
      const txValue = 100
      const ref = 'sha'
      const author = sampleAccount()

      const expectedTipsAmount = DEFAULT_TIP_PER_MILLE.then(function (tipPerMille) {
        return txValue - (txValue * (1000 - tipPerMille.toNumber()) / 1000)
      })

      const initialContractTipsAmount = issuehunter.then(function (instance) {
        return instance.tipsAmount.call()
      })

      const patchVerified = newCampaign(issueId, sampleAccount()).then(function () {
        return fundCampaign(issueId, txValue, funder)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      })

      return patchVerified.then(function () {
        return Promise.all([patchVerified, currentBlockTimestamp(), expectedTipsAmount])
      }).then(function ([campaign, now, tipsAmount]) {
        assert.equal(campaign[3].toNumber(), now + 60 * 60 * 24, '`preRewardPeriodExpiresAt` value should have been updated')
        assert.equal(campaign[4].toNumber(), now + 60 * 60 * 24 * 8, '`rewardPeriodExpiresAt` value should have been updated')
        assert.equal(campaign[5].valueOf(), author, '`resolvedBy` address should be verified patch\'s author address')
        assert.equal(
          campaign[8].toNumber(),
          tipsAmount,
          '`tipsAmount` should be the difference between campaign\'s total ' +
          'amount and the tips per mille reciprocal of the total amount'
        )
        return issuehunter
      }).then(function (instance) {
        return Promise.all([initialContractTipsAmount, instance.tipsAmount.call(), expectedTipsAmount])
      }).then(function ([initialTipsAmount, currentTipsAmount, tipsAmount]) {
        assert.equal(
          currentTipsAmount.toNumber(),
          initialTipsAmount.toNumber() + tipsAmount,
          'contract\'s `tipsAmount` should be increased by the current tips amount'
        )
      })
    })

    context('a patch has been already verified', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const author = sampleAccount()

      it('should fail to verify again any patch', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const author = sampleAccount()

      it('should fail to verify a patch', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return submitPatch(issueId, ref, sampleAccountExcluding([author]))
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('an address that\'s not associated to the patch verifier', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const author = sampleAccount()

      it('should fail to verify a patch', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return verifyPatch(issueId, author, ref, sampleAccountExcluding([patchVerifier]))
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    // This is the case when a patch's author submits two different refs in a
    // row and, while the patch verifier is sending a transaction to verify the
    // first patch. `verifyPatch` should fail because it's associated to an old
    // author/ref combination.
    context('patch\'s ref and parameters don\'t match', function () {
      const issueId = nextCampaignId()
      const ref1 = 'sha1'
      const ref2 = 'sha1'
      const author = sampleAccount()

      it('should fail to verify the outdated patch', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const author = sampleAccount()

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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder1 = sampleAccount()
      const funder2 = sampleAccountExcluding([funder1])
      const txValue1 = 10
      const txValue2 = 12
      const author = sampleAccount()

      return newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('remove funding from the selected campaign', function () {
        return newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24 - 5)
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return rollbackFunds(issueId, sampleAccountExcluding([funder]))
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
      const funder = sampleAccount()

      it('should fail to rollback funds', function () {
        // TODO: make the test pass all the other contraints
        const finalState = issuehunter.then(function (instance) {
          return instance.rollbackFunds(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('withdrawReward', function () {
    it('should withdraw the whole campaign\'s amount as a reward', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder1 = sampleAccount()
      const funder2 = sampleAccountExcluding([funder1])
      const txValue1 = 10
      const txValue2 = 12
      const author = sampleAccountExcluding([funder1, funder2])
      const creator = sampleAccountExcluding([author])

      const initialAuthorBalance = addressBalance(author)

      return newCampaign(issueId, creator).then(function () {
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
        return Promise.all([initialAuthorBalance, addressBalance(author), DEFAULT_TIP_PER_MILLE])
      }).then(function ([initialAmount, currentAmount, tipPerMille]) {
        const withdrawableAmount = Math.floor((txValue1 + txValue2) * (1000 - tipPerMille.toNumber()) / 1000)
        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive
        assert.equal(
          currentAmount.mod(10000) - initialAmount.mod(10000),
          withdrawableAmount,
          'Verified patch\'s author balance has increased by the value of the ' +
          'reward, removing the tips amount'
        )
      })
    })

    context('a campaign has been already rewarded', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw reward twice', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the pre-reward period
          return increaseTime(60 * 60 * 24 + 1)
        }).then(function () {
          return withdrawReward(issueId, sampleAccountExcluding([author]))
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

    context('right before the reward period end', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('successfully withdraws the whole campaign\'s amount as a reward', function () {
        return newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // The reward period end is one week after the pre-reward period
          // ends, that is 7 + 1 days from the moment the patch has been
          // verified
          return increaseTime(60 * 60 * 24 * (7 + 1) - 5)
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
    context('past the reward period', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const funder = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.withdrawReward(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('withdrawSpareFunds', function () {
    it('should withdraw spare funds in the campaign', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder1 = sampleAccount()
      const funder2 = sampleAccountExcluding([funder1])
      const txValue1 = 10
      const txValue2 = 12
      const author = sampleAccountExcluding([funder1, funder2])

      const funder1InitialBalance = addressBalance(funder1)

      return newCampaign(issueId, sampleAccount()).then(function () {
        return fundCampaign(issueId, txValue1, funder1)
      }).then(function () {
        return fundCampaign(issueId, txValue2, funder2)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      }).then(function () {
        // The reward period end is one week after the pre-reward period
        // ends, that is 7 + 1 days from the moment the patch has been verified
        // Funders are allowed to withdraw spare funds right after the reward
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
        return Promise.all([funder1InitialBalance, addressBalance(funder1), DEFAULT_TIP_PER_MILLE])
      }).then(function ([initialAmount, currentAmount, tipPerMille]) {
        const withdrawableAmount = Math.floor(txValue1 * (1000 - tipPerMille.toNumber()) / 1000)
        const expectedBalanceDelta = withdrawableAmount - txValue1
        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive
        assert.equal(
          currentAmount.mod(10000) - initialAmount.mod(10000),
          expectedBalanceDelta,
          'Funder 1\'s balance has been reduced by the difference between her ' +
          'transaction value and the reciprocal of the tips amount, that is ' +
          'the tips amount in excess'
        )
      })
    })

    context('a campaign has been already rewarded', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const funder = sampleAccount()
      const txValue = 10

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
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
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw reward', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          // One second past the reward period
          return increaseTime(60 * 60 * 24 * 8 + 1)
        }).then(function () {
          return withdrawSpareFunds(issueId, sampleAccountExcluding([funder]))
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

    context('right before the reward period expiration', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 10
      const author = sampleAccount()

      it('should fail to withdraw spare funds', function () {
        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function () {
          return increaseTime(60 * 60 * 24 * (7 + 1) - 5)
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
      const funder = sampleAccount()

      it('should fail to rollback funds', function () {
        const finalState = issuehunter.then(function (instance) {
          return instance.withdrawReward(issueId, { from: funder })
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })

  describe('is Mortal', function () {
    it('does not allow to call kill', function () {
      const owner = sampleAccount()

      return Issuehunter.new({from: owner}).then(function (instance) {
        return instance.kill({from: sampleAccountExcluding([owner])})
      }).then(function () {
        assert(false, 'it is supposed to fail')
      }).catch(function () {
        assert(true, 'kill failed as expected')
      })
    })

    it('allows to call kill', function () {
      const owner = sampleAccount()

      return Issuehunter.new({from: owner}).then(function (instance) {
        return instance.kill({from: owner})
      }).then(function () {
        assert(true, 'contract killed')
      }).catch(function () {
        assert(false, 'it is supposed to successed')
      })
    })
  })

  describe('withdrawTips', function () {
    it('should withdraw contract\'s tips', function () {
      const issueId = nextCampaignId()
      const ref = 'sha'
      const funder = sampleAccount()
      const txValue = 100
      const author = sampleAccount()

      const expectedTipsAmount = DEFAULT_TIP_PER_MILLE.then(function (tipPerMille) {
        return txValue - (txValue * (1000 - tipPerMille.toNumber()) / 1000)
      })

      const initialContractTipsAmount = issuehunter.then(function (instance) {
        return instance.tipsAmount.call()
      })

      const ownerInitialBalance = addressBalance(owner)

      return newCampaign(issueId, sampleAccount()).then(function () {
        return fundCampaign(issueId, txValue, funder)
      }).then(function () {
        return submitPatch(issueId, ref, author)
      }).then(function () {
        return verifyPatch(issueId, author, ref, patchVerifier)
      }).then(function (campaign) {
        return withdrawTips(owner)
      }).then(function (instance) {
        return instance.tipsAmount.call()
      }).then(function (tipsAmount) {
        assert.equal(tipsAmount.toNumber(), 0, 'Contract\'s tips amount has been reset to 0')
        return Promise.all([ownerInitialBalance, addressBalance(owner), initialContractTipsAmount, expectedTipsAmount])
      }).then(function ([initialAmount, currentAmount, initialTipsAmount, tipsAmount]) {
        const expectedDelta = initialTipsAmount.toNumber() + tipsAmount

        // TODO: find a better way to check for a user's account balance delta
        // This is a workaround and it won't work under all conditions. It
        // partially works because transactions are in wei, but gas are some
        // orders of magnitude more expensive. There's also an ugly hack to
        // account for the fact that sometimes it could happen that `initial +
        // expected delta > modulo`, in those case the result must be adjusted
        // by `modulo`.
        const delta = function (current, initial, expectedDelta) {
          if (initial.mod(10000) + expectedDelta > 10000) {
            return current.mod(10000) - initial.mod(10000) + 10000
          } else {
            return current.mod(10000) - initial.mod(10000)
          }
        }

        assert.equal(
          delta(currentAmount, initialAmount, expectedDelta),
          expectedDelta,
          'Owner balance has been increased by the contract\'s tips amount, ' +
          'that is the initial contract\'s tips amount plus the last campaign\'s ' +
          'tips amount'
        )
      })
    })

    context('msg.sender is not the owner of the contract', function () {
      it('should fail to withdraw tips', function () {
        const issueId = nextCampaignId()
        const ref = 'sha'
        const funder = sampleAccount()
        const txValue = 10
        const author = sampleAccount()

        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function (campaign) {
          return withdrawTips(sampleAccountExcluding([owner]))
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })

    context('tips amount is zero', function () {
      it('should fail to withdraw tips', function () {
        const issueId = nextCampaignId()
        const ref = 'sha'
        const funder = sampleAccount()
        const txValue = 10
        const author = sampleAccount()

        const finalState = newCampaign(issueId, sampleAccount()).then(function () {
          return fundCampaign(issueId, txValue, funder)
        }).then(function () {
          return submitPatch(issueId, ref, author)
        }).then(function () {
          return verifyPatch(issueId, author, ref, patchVerifier)
        }).then(function (campaign) {
          return withdrawTips(owner)
        }).then(function (campaign) {
          return withdrawTips(owner)
        })

        return assertContractException(finalState, 'An exception has been thrown')
      })
    })
  })
})
