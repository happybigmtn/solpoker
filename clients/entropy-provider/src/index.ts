/**
 * Entropy Provider - Off-chain daemon for robopoker VRF
 */

export {
  generateHashChain,
  loadHashChain,
  saveHashChain,
  getCurrentCommitment,
  getCurrentPreimage,
  advanceChain,
  verifyHashChain,
  verifyPreimage,
  getRemainingEntries,
  isChainExhausted,
  DEFAULT_CHAIN_DEPTH,
  type HashChain,
} from "./hash-chain.js";
