//! Entropy Program - Self-hosted VRF-style randomness for on-chain poker.
//!
//! This program implements a commit-reveal scheme where:
//! 1. Provider posts a commitment (hash of preimage chain)
//! 2. Requests are made against the commitment
//! 3. Provider reveals preimage within a slot window
//! 4. Randomness is derived from preimage XOR slothash
//!
//! Failure to reveal triggers bond slashing.

#![no_std]

extern crate alloc;

use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult};

// Set up no_std panic handler for Solana target
pinocchio::nostd_panic_handler!();
pinocchio::default_allocator!();

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

// Program ID - will be replaced with actual deployed address
pinocchio_pubkey::declare_id!("GG5nqvfpYHXyMF5A5yyMYjTCKQmKTDjMheJ4iCRSvTRf");

pinocchio::program_entrypoint!(process_instruction);

/// Main instruction processor
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Verify we're the right program
    if program_id != &crate::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    processor::process(accounts, instruction_data)
}
