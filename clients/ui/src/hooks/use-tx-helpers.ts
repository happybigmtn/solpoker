'use client';

/**
 * Shared transaction helper utilities for Solana hooks.
 *
 * Provides:
 * - Token program detection from mint accounts
 * - Blockhash expiry detection
 */

import { type Address } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '@robopoker/client';

/**
 * Known token program addresses.
 * SPL Token (classic): TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
 * Token-2022: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
 */
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export const TOKEN_PROGRAMS = {
  TOKEN: TOKEN_PROGRAM_ID as Address,
  TOKEN_2022: TOKEN_2022_PROGRAM_ID as Address,
} as const;

/**
 * Detect the token program for a given mint by checking its owner.
 *
 * @param rpc - RPC client
 * @param mint - Mint address to check
 * @returns The token program address (Token or Token-2022)
 */
export async function detectTokenProgram(
  rpc: { getAccountInfo: (address: Address, opts: { encoding: string }) => { send: () => Promise<{ value: { owner: Address } | null }> } },
  mint: Address
): Promise<Address> {
  try {
    const { value: mintInfo } = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();

    if (mintInfo?.owner) {
      // Check if owner is Token-2022 or classic Token program
      if (mintInfo.owner === TOKEN_PROGRAMS.TOKEN_2022) {
        return TOKEN_PROGRAMS.TOKEN_2022;
      }
      if (mintInfo.owner === TOKEN_PROGRAMS.TOKEN) {
        return TOKEN_PROGRAMS.TOKEN;
      }
      // If owner matches neither, return it as-is (could be a custom token program)
      return mintInfo.owner;
    }
  } catch (err) {
    console.warn('[detectTokenProgram] Failed to detect token program, defaulting to Token-2022:', err);
  }

  // Default to Token-2022 (our CRISPS token uses it)
  return TOKEN_PROGRAMS.TOKEN_2022;
}

/**
 * Check if an error is a blockhash expiry error.
 *
 * @param error - The error to check
 * @returns True if the error indicates blockhash expiry
 */
export function isBlockhashExpired(error: unknown): boolean {
  if (!error) return false;

  const errorString = error instanceof Error ? error.message : String(error);

  return (
    errorString.includes('blockhash') &&
    (errorString.includes('expired') ||
     errorString.includes('not found') ||
     errorString.includes('BlockhashNotFound'))
  );
}

/**
 * Check if an error is a transaction already processed error.
 * This can happen during retries.
 *
 * @param error - The error to check
 * @returns True if the transaction was already processed
 */
export function isAlreadyProcessed(error: unknown): boolean {
  if (!error) return false;

  const errorString = error instanceof Error ? error.message : String(error);

  return (
    errorString.includes('AlreadyProcessed') ||
    errorString.includes('already been processed')
  );
}

/**
 * Extract error code from a Solana RPC error if available.
 *
 * @param error - The error to extract from
 * @returns The error code or undefined
 */
export function extractErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const err = error as {
    code?: number;
    data?: { err?: { InstructionError?: [number, { Custom: number }] } };
    cause?: { code?: number };
  };

  // Direct code
  if (typeof err.code === 'number') return err.code;

  // Nested in cause
  if (typeof err.cause?.code === 'number') return err.cause.code;

  // Custom program error
  const instructionError = err.data?.err?.InstructionError;
  if (instructionError && Array.isArray(instructionError) && instructionError.length >= 2) {
    const [, errorDetails] = instructionError;
    if (typeof errorDetails === 'object' && 'Custom' in errorDetails) {
      return errorDetails.Custom;
    }
  }

  return undefined;
}
