/**
 * Hash Chain Management for Entropy Provider
 *
 * Implements a commit-reveal hash chain where:
 * - Chain is generated from a seed by repeated SHA-256 hashing
 * - The "head" (commitment) is Hash(preimage[position])
 * - Revealing preimage[position] proves knowledge and advances the chain
 *
 * Chain structure:
 *   preimages[depth-1] = seed
 *   preimages[i] = SHA256(preimages[i+1]) for i < depth-1
 *   commitment = SHA256(preimages[0])
 *
 * This means revealing preimages[0] proves the provider knew the commitment.
 */

import { sha256 } from "@noble/hashes/sha256";
import { readFile, writeFile } from "node:fs/promises";

/** Default chain depth if not specified */
export const DEFAULT_CHAIN_DEPTH = 10_000;

/** Hash chain file format version */
const FILE_VERSION = 1;

/**
 * A hash chain with preimages and current position
 */
export interface HashChain {
  /** All preimages from position 0 to depth-1 */
  preimages: Uint8Array[];
  /** Current position (next preimage to reveal) */
  position: number;
  /** Total chain depth */
  depth: number;
}

/**
 * Serialized format for storage
 */
interface HashChainFile {
  version: number;
  depth: number;
  position: number;
  /** Base64-encoded preimages */
  preimages: string[];
}

/**
 * Generate a new hash chain from a seed.
 *
 * The chain is constructed in reverse order:
 * - preimages[depth-1] = seed (or hash of seed if seed isn't 32 bytes)
 * - preimages[i] = SHA256(preimages[i+1]) for i < depth-1
 *
 * @param seed - Random seed bytes (will be hashed if not 32 bytes)
 * @param depth - Number of preimages in the chain
 * @returns A new hash chain starting at position 0
 */
export function generateHashChain(seed: Uint8Array, depth: number = DEFAULT_CHAIN_DEPTH): HashChain {
  if (depth < 1) {
    throw new Error("Chain depth must be at least 1");
  }

  // Normalize seed to 32 bytes
  const normalizedSeed = seed.length === 32 ? seed : sha256(seed);

  // Allocate all preimages
  const preimages: Uint8Array[] = new Array(depth);

  // Start from the end (seed position)
  preimages[depth - 1] = new Uint8Array(normalizedSeed);

  // Build chain backwards: preimages[i] = SHA256(preimages[i+1])
  for (let i = depth - 2; i >= 0; i--) {
    preimages[i] = sha256(preimages[i + 1]);
  }

  return {
    preimages,
    position: 0,
    depth,
  };
}

/**
 * Get the current commitment (hash of the next preimage to reveal).
 *
 * The commitment is SHA256(preimages[position]).
 * Revealing preimages[position] will prove this commitment.
 *
 * @param chain - The hash chain
 * @returns The current commitment (32 bytes)
 * @throws If the chain is exhausted
 */
export function getCurrentCommitment(chain: HashChain): Uint8Array {
  if (chain.position >= chain.depth) {
    throw new Error("Hash chain exhausted - no more commitments available");
  }
  return sha256(chain.preimages[chain.position]);
}

/**
 * Get the current preimage (the one that will be revealed next).
 *
 * @param chain - The hash chain
 * @returns The current preimage (32 bytes)
 * @throws If the chain is exhausted
 */
export function getCurrentPreimage(chain: HashChain): Uint8Array {
  if (chain.position >= chain.depth) {
    throw new Error("Hash chain exhausted - no preimage available");
  }
  return chain.preimages[chain.position];
}

/**
 * Advance the chain by one position (after revealing current preimage).
 *
 * This mutates the chain in place and returns the consumed preimage.
 *
 * @param chain - The hash chain to advance
 * @returns Object with the consumed preimage and new commitment
 * @throws If the chain is exhausted
 */
export function advanceChain(chain: HashChain): { preimage: Uint8Array; newCommitment: Uint8Array | null } {
  if (chain.position >= chain.depth) {
    throw new Error("Hash chain exhausted - cannot advance");
  }

  const preimage = chain.preimages[chain.position];
  chain.position++;

  // Get new commitment if chain not exhausted
  const newCommitment = chain.position < chain.depth ? sha256(chain.preimages[chain.position]) : null;

  return { preimage, newCommitment };
}

/**
 * Get remaining entries in the chain.
 */
export function getRemainingEntries(chain: HashChain): number {
  return chain.depth - chain.position;
}

/**
 * Check if a chain is exhausted (no more preimages to reveal).
 */
export function isChainExhausted(chain: HashChain): boolean {
  return chain.position >= chain.depth;
}

/**
 * Save a hash chain to a file.
 *
 * @param chain - The hash chain to save
 * @param path - File path to save to
 */
export async function saveHashChain(chain: HashChain, path: string): Promise<void> {
  const file: HashChainFile = {
    version: FILE_VERSION,
    depth: chain.depth,
    position: chain.position,
    preimages: chain.preimages.map((p) => Buffer.from(p).toString("base64")),
  };

  await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
}

/**
 * Load a hash chain from a file.
 *
 * @param path - File path to load from
 * @returns The loaded hash chain
 */
export async function loadHashChain(path: string): Promise<HashChain> {
  const content = await readFile(path, "utf-8");
  const file: HashChainFile = JSON.parse(content);

  if (file.version !== FILE_VERSION) {
    throw new Error(`Unsupported hash chain file version: ${file.version}`);
  }

  if (file.preimages.length !== file.depth) {
    throw new Error(`Invalid chain file: depth ${file.depth} but ${file.preimages.length} preimages`);
  }

  const preimages = file.preimages.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));

  return {
    preimages,
    position: file.position,
    depth: file.depth,
  };
}

/**
 * Verify that a hash chain is internally consistent.
 *
 * Checks that Hash(preimage[i]) === preimage[i-1] for all valid i.
 *
 * @param chain - The hash chain to verify
 * @returns true if the chain is valid, false otherwise
 */
export function verifyHashChain(chain: HashChain): boolean {
  for (let i = chain.depth - 2; i >= 0; i--) {
    const expected = sha256(chain.preimages[i + 1]);
    if (!arraysEqual(expected, chain.preimages[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Verify that a preimage matches a commitment.
 *
 * @param preimage - The preimage to verify
 * @param commitment - The expected commitment
 * @returns true if SHA256(preimage) === commitment
 */
export function verifyPreimage(preimage: Uint8Array, commitment: Uint8Array): boolean {
  const computed = sha256(preimage);
  return arraysEqual(computed, commitment);
}

/** Helper to compare two Uint8Arrays */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
