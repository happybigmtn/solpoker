//! Poker Program - On-chain multiplayer poker with CRISPS escrow.
//!
//! This program implements:
//! - CRISPS (Token-2022) mint configuration (AC-POK3.1)
//! - PDA-owned table vault token accounts (AC-POK3.2)
//! - Join/leave flows with proper escrow transfers (AC-POK3.3)

#![no_std]

extern crate alloc;

use pinocchio::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

// Set up no_std panic handler for Solana target
pinocchio::nostd_panic_handler!();
pinocchio::default_allocator!();

pub mod error;
pub mod entropy;
pub mod entropy_cpi;
pub mod instruction;
pub mod processor;
pub mod state;
pub mod token_cpi;

// Program ID - will be replaced with actual deployed address
pinocchio_pubkey::declare_id!("CNLMFh8DNRLyrx5x1ecrspTHpa3nTzMaophZxxUjgKMi");

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
