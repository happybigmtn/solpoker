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

export {
  postCommitment,
  verifyCommitmentOnChain,
  initCommitmentState,
  deriveCommitmentPda,
  COMMITMENT_SIZE,
  type EntropyProviderConfig,
  type PendingCommitment,
  type CommitmentState,
} from "./commit.js";

export {
  getCurrentSlot,
  waitForSlot,
  isWithinRevealWindow,
  fetchCommitmentAccount,
  revealCommitment,
  waitAndReveal,
  verifyRevealOnChain,
  deriveRandomness,
  type RevealResult,
  type CommitmentAccountData,
} from "./reveal.js";

export {
  RequestWatcher,
  AutoHandler,
  createRequestProcessor,
  fetchPendingRequests,
  parseRequestAccount,
  deriveRequestPda,
  REQUEST_SIZE,
  REQUEST_STATUS,
  type RequestAccountData,
  type RequestDetectedEvent,
  type RequestHandler,
  type RequestWatcherConfig,
} from "./subscription.js";
