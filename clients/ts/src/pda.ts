/**
 * PDA derivation utilities for robopoker programs.
 *
 * These functions derive Program Derived Addresses (PDAs) that match
 * the Rust program derivations exactly. Each function returns a Promise
 * of [address, bump] tuple.
 *
 * @module pda
 */

import {
  type Address,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "@solana/kit";

// ============================================================================
// Poker Program PDAs
// ============================================================================

/**
 * Derive the poker config PDA.
 * Seeds: ["config"]
 *
 * @param programId - The poker program ID
 * @returns Promise of [address, bump] tuple
 */
export async function derivePokerConfigPda(
  programId: Address
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("config")],
  });
}

/**
 * Derive a table PDA.
 * Seeds: ["table", table_id.to_le_bytes()]
 *
 * @param programId - The poker program ID
 * @param tableId - The table ID (bigint)
 * @returns Promise of [address, bump] tuple
 */
export async function deriveTablePda(
  programId: Address,
  tableId: bigint
): Promise<readonly [Address, number]> {
  const tableIdBytes = bigintToLeBytes(tableId, 8);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("table"), tableIdBytes],
  });
}

/**
 * Derive a table vault PDA.
 * Seeds: ["vault", table_id.to_le_bytes()]
 *
 * @param programId - The poker program ID
 * @param tableId - The table ID (bigint)
 * @returns Promise of [address, bump] tuple
 */
export async function deriveVaultPda(
  programId: Address,
  tableId: bigint
): Promise<readonly [Address, number]> {
  const tableIdBytes = bigintToLeBytes(tableId, 8);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("vault"), tableIdBytes],
  });
}

/**
 * Derive the staking pool PDA.
 * Seeds: ["staking_pool"]
 *
 * @param programId - The poker program ID
 * @returns Promise of [address, bump] tuple
 */
export async function deriveStakingPoolPda(
  programId: Address
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("staking_pool")],
  });
}

/**
 * Derive a staker position PDA.
 * Seeds: ["staker", staker_pubkey]
 *
 * @param programId - The poker program ID
 * @param staker - The staker's pubkey
 * @returns Promise of [address, bump] tuple
 */
export async function deriveStakerPositionPda(
  programId: Address,
  staker: Address
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  const stakerBytes = encoder.encode(staker);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("staker"), stakerBytes],
  });
}

/**
 * Derive the stake vault PDA.
 * Seeds: ["stake_vault"]
 *
 * @param programId - The poker program ID
 * @returns Promise of [address, bump] tuple
 */
export async function deriveStakeVaultPda(
  programId: Address
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("stake_vault")],
  });
}

/**
 * Derive the rewards vault PDA.
 * Seeds: ["rewards_vault"]
 *
 * @param programId - The poker program ID
 * @returns Promise of [address, bump] tuple
 */
export async function deriveRewardsVaultPda(
  programId: Address
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("rewards_vault")],
  });
}

// ============================================================================
// Entropy Program PDAs
// ============================================================================

/**
 * Derive the entropy config PDA.
 * Seeds: ["config"]
 *
 * @param programId - The entropy program ID
 * @returns Promise of [address, bump] tuple
 */
export async function deriveEntropyConfigPda(
  programId: Address
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("config")],
  });
}

/**
 * Derive a commitment PDA.
 * Seeds: ["commitment", provider, sequence.to_le_bytes()]
 *
 * @param programId - The entropy program ID
 * @param provider - The provider's pubkey
 * @param sequence - The sequence number (bigint)
 * @returns Promise of [address, bump] tuple
 */
export async function deriveCommitmentPda(
  programId: Address,
  provider: Address,
  sequence: bigint
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  const providerBytes = encoder.encode(provider);
  const sequenceBytes = bigintToLeBytes(sequence, 8);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      new TextEncoder().encode("commitment"),
      providerBytes,
      sequenceBytes,
    ],
  });
}

/**
 * Derive a request PDA.
 * Seeds: ["request", requester, request_id.to_le_bytes()]
 *
 * @param programId - The entropy program ID
 * @param requester - The requester's pubkey
 * @param requestId - The request ID (bigint)
 * @returns Promise of [address, bump] tuple
 */
export async function deriveRequestPda(
  programId: Address,
  requester: Address,
  requestId: bigint
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  const requesterBytes = encoder.encode(requester);
  const requestIdBytes = bigintToLeBytes(requestId, 8);
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("request"), requesterBytes, requestIdBytes],
  });
}

// ============================================================================
// Token Program PDAs
// ============================================================================

/** Associated Token Account Program ID */
const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

/** Token-2022 Program ID */
const TOKEN_2022_PROGRAM_ID: Address =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;

/**
 * Derive an Associated Token Account (ATA) PDA.
 * Seeds: [wallet, token_program, mint]
 * Program: Associated Token Account Program
 *
 * This works for both Token and Token-2022 mints.
 *
 * @param wallet - The wallet's pubkey
 * @param mint - The token mint address
 * @param tokenProgramId - The token program ID (Token or Token-2022)
 * @returns Promise of [address, bump] tuple
 */
export async function deriveAssociatedTokenAccount(
  wallet: Address,
  mint: Address,
  tokenProgramId: Address = TOKEN_2022_PROGRAM_ID
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  const walletBytes = encoder.encode(wallet);
  const tokenProgramBytes = encoder.encode(tokenProgramId);
  const mintBytes = encoder.encode(mint);

  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [walletBytes, tokenProgramBytes, mintBytes],
  });
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Convert a bigint to little-endian byte array.
 *
 * @param value - The bigint value to convert
 * @param byteLength - The number of bytes in the result
 * @returns Uint8Array of little-endian bytes
 */
function bigintToLeBytes(value: bigint, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let remaining = value;
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
