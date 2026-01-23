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
import { TOKEN_2022_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./constants.js";

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
export const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

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
  tokenProgramId: Address = TOKEN_2022_PROGRAM_ID as Address
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

/**
 * Account meta structure for instruction building.
 */
export interface AccountMeta {
  address: Address;
  role: 'readonly' | 'writable' | 'readonly_signer' | 'writable_signer';
}

/**
 * Build account metas for creating an Associated Token Account (idempotent).
 * This instruction will create the ATA if it doesn't exist, or succeed silently if it does.
 *
 * Accounts:
 * 0. [writable, signer] Payer (funding account)
 * 1. [writable] Associated token account address
 * 2. [] Wallet address
 * 3. [] Token mint
 * 4. [] System program
 * 5. [] Token program (Token-2022)
 *
 * @param payer - The payer for account creation (writable, signer)
 * @param ata - The ATA address to create
 * @param wallet - The wallet that will own the ATA
 * @param mint - The token mint address
 * @param tokenProgramId - Token program ID (defaults to Token-2022)
 */
export function getCreateAtaIdempotentAccountMetas(params: {
  payer: Address;
  ata: Address;
  wallet: Address;
  mint: Address;
  tokenProgramId?: Address;
}): AccountMeta[] {
  const tokenProgram = params.tokenProgramId ?? (TOKEN_2022_PROGRAM_ID as Address);
  return [
    { address: params.payer, role: 'writable_signer' },
    { address: params.ata, role: 'writable' },
    { address: params.wallet, role: 'readonly' },
    { address: params.mint, role: 'readonly' },
    { address: SYSTEM_PROGRAM_ID as Address, role: 'readonly' },
    { address: tokenProgram, role: 'readonly' },
  ];
}

/**
 * Build instruction data for CreateIdempotent (instruction discriminator = 1).
 * This is a single byte: 0x01.
 */
export function buildCreateAtaIdempotentData(): Uint8Array {
  return new Uint8Array([1]); // CreateIdempotent = 1
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
  // Validate value fits in the target byte length
  if (value < 0n) {
    throw new Error(`bigintToLeBytes: negative values not supported, got ${value}`);
  }
  const maxValue = (1n << BigInt(byteLength * 8)) - 1n;
  if (value > maxValue) {
    throw new Error(
      `bigintToLeBytes: value ${value} exceeds max ${maxValue} for ${byteLength} bytes`
    );
  }

  const bytes = new Uint8Array(byteLength);
  let remaining = value;
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
