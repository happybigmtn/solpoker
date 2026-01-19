//! Token-2022 CPI helpers using raw invoke.
//!
//! This module provides manual CPI for Token-2022 transfers since
//! pinocchio 0.9's AccountInfo is not compatible with pinocchio-token-2022's
//! AccountView API.

use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    instruction::{AccountMeta, Instruction, Signer},
    pubkey::Pubkey,
    ProgramResult,
};

/// Token-2022 program ID (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
pub const TOKEN_2022_PROGRAM_ID: Pubkey = [
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
    28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
];

/// SPL Token transfer instruction discriminator
const TOKEN_TRANSFER_DISCRIMINATOR: u8 = 3;

/// Transfer tokens from one account to another.
///
/// # Arguments
/// * `from` - Source token account (writable)
/// * `to` - Destination token account (writable)
/// * `authority` - Authority over the source account (signer)
/// * `amount` - Amount of tokens to transfer
/// * `token_program` - Token program account
pub fn transfer<'a>(
    from: &'a AccountInfo,
    to: &'a AccountInfo,
    authority: &'a AccountInfo,
    amount: u64,
    token_program: &'a AccountInfo,
) -> ProgramResult {
    transfer_signed(from, to, authority, amount, token_program, &[])
}

/// Transfer tokens from one account to another with PDA signer seeds.
///
/// # Arguments
/// * `from` - Source token account (writable)
/// * `to` - Destination token account (writable)
/// * `authority` - Authority over the source account (can be PDA)
/// * `amount` - Amount of tokens to transfer
/// * `token_program` - Token program account
/// * `signer_seeds` - Seeds for PDA signing
pub fn transfer_signed<'a>(
    from: &'a AccountInfo,
    to: &'a AccountInfo,
    authority: &'a AccountInfo,
    amount: u64,
    token_program: &'a AccountInfo,
    signer_seeds: &[Signer],
) -> ProgramResult {
    // Build instruction data: [discriminator (1 byte), amount (8 bytes)]
    let mut instruction_data = [0u8; 9];
    instruction_data[0] = TOKEN_TRANSFER_DISCRIMINATOR;
    instruction_data[1..9].copy_from_slice(&amount.to_le_bytes());

    // Build account metas
    let account_metas = [
        AccountMeta::writable(from.key()),
        AccountMeta::writable(to.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    // Build instruction
    let instruction = Instruction {
        program_id: token_program.key(),
        accounts: &account_metas,
        data: &instruction_data,
    };

    // Invoke with signers
    let account_infos = [from, to, authority, token_program];
    invoke_signed::<4>(&instruction, &account_infos, signer_seeds)
}
