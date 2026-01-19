/**
 * Entropy program instruction builders
 *
 * These functions construct instruction data that matches the Rust entropy program's
 * expected layouts exactly, including alignment and padding.
 */

import { ENTROPY_DISCRIMINATOR } from "../constants.js";
import type {
  EntropyInitializeArgs,
  EntropyInitializeAccounts,
  EntropyCommitArgs,
  EntropyCommitAccounts,
  EntropyRevealArgs,
  EntropyRevealAccounts,
  EntropyRequestArgs,
  EntropyRequestAccounts,
  EntropyFinalizeAccounts,
  EntropySlashAccounts,
  EntropyUpdateConfigArgs,
  EntropyUpdateConfigAccounts,
} from "../types.js";

/**
 * Build instruction data for Entropy Initialize
 * Layout: discriminator(1) + padding(7) + min_bond(8) + reveal_window_slots(8) + slash_basis_points(8) = 32 bytes
 */
export function buildEntropyInitializeData(args: EntropyInitializeArgs): Uint8Array {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);

  data[0] = ENTROPY_DISCRIMINATOR.INITIALIZE;
  // padding [1..8]
  view.setBigUint64(8, args.minBond, true);
  view.setBigUint64(16, args.revealWindowSlots, true);
  view.setBigUint64(24, args.slashBasisPoints, true);

  return data;
}

/**
 * Get account metas for Entropy Initialize instruction
 */
export function getEntropyInitializeAccountMetas(accounts: EntropyInitializeAccounts) {
  return [
    { address: accounts.config, role: "writable" as const },
    { address: accounts.authority, role: "signer" as const },
    { address: accounts.provider, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy Commit
 * Layout: discriminator(1) + padding(7) + hash(32) + sequence(8) + bond_amount(8) = 56 bytes
 */
export function buildEntropyCommitData(args: EntropyCommitArgs): Uint8Array {
  if (args.hash.length !== 32) {
    throw new Error("hash must be 32 bytes");
  }

  const data = new Uint8Array(56);
  const view = new DataView(data.buffer);

  data[0] = ENTROPY_DISCRIMINATOR.COMMIT;
  // padding [1..8]
  data.set(args.hash, 8);
  view.setBigUint64(40, args.sequence, true);
  view.setBigUint64(48, args.bondAmount, true);

  return data;
}

/**
 * Get account metas for Entropy Commit instruction
 */
export function getEntropyCommitAccountMetas(accounts: EntropyCommitAccounts) {
  return [
    { address: accounts.commitment, role: "writable" as const },
    { address: accounts.provider, role: "writable_signer" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy Reveal
 * Layout: discriminator(1) + padding(7) + preimage(32) = 40 bytes
 */
export function buildEntropyRevealData(args: EntropyRevealArgs): Uint8Array {
  if (args.preimage.length !== 32) {
    throw new Error("preimage must be 32 bytes");
  }

  const data = new Uint8Array(40);

  data[0] = ENTROPY_DISCRIMINATOR.REVEAL;
  // padding [1..8]
  data.set(args.preimage, 8);

  return data;
}

/**
 * Get account metas for Entropy Reveal instruction
 */
export function getEntropyRevealAccountMetas(accounts: EntropyRevealAccounts) {
  return [
    { address: accounts.commitment, role: "writable" as const },
    { address: accounts.provider, role: "signer" as const },
    { address: accounts.config, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy Request
 * Layout: discriminator(1) + padding(7) + request_id(8) = 16 bytes
 */
export function buildEntropyRequestData(args: EntropyRequestArgs): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);

  data[0] = ENTROPY_DISCRIMINATOR.REQUEST;
  // padding [1..8]
  view.setBigUint64(8, args.requestId, true);

  return data;
}

/**
 * Get account metas for Entropy Request instruction
 */
export function getEntropyRequestAccountMetas(accounts: EntropyRequestAccounts) {
  return [
    { address: accounts.request, role: "writable" as const },
    { address: accounts.requester, role: "signer" as const },
    { address: accounts.commitment, role: "readonly" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.slotHashes, role: "readonly" as const },
    { address: accounts.systemProgram, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy Finalize
 * Layout: discriminator(1) = 1 byte
 */
export function buildEntropyFinalizeData(): Uint8Array {
  return new Uint8Array([ENTROPY_DISCRIMINATOR.FINALIZE]);
}

/**
 * Get account metas for Entropy Finalize instruction
 */
export function getEntropyFinalizeAccountMetas(accounts: EntropyFinalizeAccounts) {
  return [
    { address: accounts.request, role: "writable" as const },
    { address: accounts.commitment, role: "readonly" as const },
    { address: accounts.config, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy Slash
 * Layout: discriminator(1) = 1 byte
 */
export function buildEntropySlashData(): Uint8Array {
  return new Uint8Array([ENTROPY_DISCRIMINATOR.SLASH]);
}

/**
 * Get account metas for Entropy Slash instruction
 */
export function getEntropySlashAccountMetas(accounts: EntropySlashAccounts) {
  return [
    { address: accounts.commitment, role: "writable" as const },
    { address: accounts.provider, role: "writable" as const },
    { address: accounts.slasher, role: "writable" as const },
    { address: accounts.config, role: "readonly" as const },
    { address: accounts.clock, role: "readonly" as const },
  ];
}

/**
 * Build instruction data for Entropy UpdateConfig
 * Layout: discriminator(1) + padding(7) + new_provider(32) + new_min_bond(8) + new_reveal_window_slots(8) + new_slash_basis_points(8) = 64 bytes
 */
export function buildEntropyUpdateConfigData(args: EntropyUpdateConfigArgs): Uint8Array {
  if (args.newProvider.length !== 32) {
    throw new Error("newProvider must be 32 bytes");
  }

  const data = new Uint8Array(64);
  const view = new DataView(data.buffer);

  data[0] = ENTROPY_DISCRIMINATOR.UPDATE_CONFIG;
  // padding [1..8]
  data.set(args.newProvider, 8);
  view.setBigUint64(40, args.newMinBond, true);
  view.setBigUint64(48, args.newRevealWindowSlots, true);
  view.setBigUint64(56, args.newSlashBasisPoints, true);

  return data;
}

/**
 * Get account metas for Entropy UpdateConfig instruction
 */
export function getEntropyUpdateConfigAccountMetas(accounts: EntropyUpdateConfigAccounts) {
  return [
    { address: accounts.config, role: "writable" as const },
    { address: accounts.authority, role: "signer" as const },
  ];
}
