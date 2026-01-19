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
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218,
    182, 26, 252, 77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
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

/// Token-2022 InitializeAccount3 instruction discriminator
const TOKEN_INIT_ACCOUNT3_DISCRIMINATOR: u8 = 18;

/// Token account size for Token-2022 (165 bytes)
pub const TOKEN_ACCOUNT_SIZE: usize = 165;

/// Create and initialize a new token account for Token-2022.
///
/// This creates the account via system program and then initializes it
/// as a Token-2022 account in a single CPI call.
///
/// # Arguments
/// * `payer` - Account paying for rent (signer)
/// * `token_account` - New token account to create (writable, PDA)
/// * `mint` - Token mint
/// * `owner` - Owner of the new token account
/// * `token_program` - Token-2022 program
/// * `system_program` - System program
/// * `signer_seeds` - Seeds for PDA signing (for token_account)
pub fn create_token_account<'a>(
    payer: &'a AccountInfo,
    token_account: &'a AccountInfo,
    mint: &'a AccountInfo,
    owner: &'a AccountInfo,
    token_program: &'a AccountInfo,
    _system_program: &'a AccountInfo,
    signer_seeds: &[Signer],
) -> ProgramResult {
    use pinocchio::sysvars::{rent::Rent, Sysvar};
    use pinocchio_system::instructions::CreateAccount;

    // First, create the account via system program
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(TOKEN_ACCOUNT_SIZE);

    CreateAccount {
        from: payer,
        to: token_account,
        lamports,
        space: TOKEN_ACCOUNT_SIZE as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke_signed(signer_seeds)?;

    // Then initialize as token account using InitializeAccount3
    // InitializeAccount3 takes owner as instruction data, not as account
    let mut instruction_data = [0u8; 33]; // discriminator (1) + owner pubkey (32)
    instruction_data[0] = TOKEN_INIT_ACCOUNT3_DISCRIMINATOR;
    instruction_data[1..33].copy_from_slice(owner.key());

    let account_metas = [
        AccountMeta::writable(token_account.key()),
        AccountMeta::readonly(mint.key()),
    ];

    let instruction = Instruction {
        program_id: token_program.key(),
        accounts: &account_metas,
        data: &instruction_data,
    };

    // We don't need signer seeds here since the account already exists
    let account_infos = [token_account, mint, token_program];
    invoke_signed::<3>(&instruction, &account_infos, &[])
}
