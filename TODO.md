# TODO

1. Proposed solution: define one contract for all issues. A struct for each
  issue, that has a layout that is similar to current contract's state
  variables, and a map to store all issues, indexed by a unique id. I wasn't
  able to find any document that states that the cost of a lookup is
  proportional to a map's size, that makes sense in terms of complexity, see
  also (7)
√. Use `transfer()` instead of `send()`, see
  https://github.com/ConsenSys/smart-contract-best-practices/blob/master/README.md#be-aware-of-the-tradeoffs-between-send-transfer-and-callvalue
√. Define `fund()` instead of using the _fallback function_, see
  https://github.com/ConsenSys/smart-contract-best-practices/blob/master/README.md#keep-fallback-functions-simple
4. Explicitly label the visibility of functions and state variables, see
  https://github.com/ConsenSys/smart-contract-best-practices/blob/master/README.md#explicitly-mark-visibility-in-functions-and-state-variables
5. Use `require()` instead of `if (...) throw`, requires solidity >= 0.4.10, see
  https://github.com/ConsenSys/smart-contract-best-practices/blob/master/README.md#use-assert-and-require-properly
6. Register contract's name, see
  https://ethereum.gitbooks.io/frontier-guide/content/contract_namereg.html
7. Compare gas required to create a new contracts VS using a single contract,
  see http://solidity.readthedocs.io/en/develop/using-the-compiler.html
8. Handle issuehunter fees
9. Add missing documentation
