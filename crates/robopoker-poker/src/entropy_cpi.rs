//! CPI helpers for the entropy program.

use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    instruction::{AccountMeta, Instruction, Signer},
    ProgramResult,
};

/// Entropy instruction discriminators (must match entropy program).
mod discriminator {
    pub const REQUEST: u8 = 3;
    pub const FINALIZE: u8 = 4;
}

pub fn request_signed(
    entropy_program: &AccountInfo,
    request: &AccountInfo,
    requester: &AccountInfo,
    payer: &AccountInfo,
    commitment: &AccountInfo,
    config: &AccountInfo,
    slothashes: &AccountInfo,
    system_program: &AccountInfo,
    request_id: u64,
    signer_seeds: &[Signer],
) -> ProgramResult {
    let mut data = [0u8; 16];
    data[0] = discriminator::REQUEST;
    data[8..16].copy_from_slice(&request_id.to_le_bytes());

    let metas = [
        AccountMeta::writable(request.key()),
        AccountMeta::readonly_signer(requester.key()),
        AccountMeta::writable_signer(payer.key()),
        AccountMeta::readonly(commitment.key()),
        AccountMeta::readonly(config.key()),
        AccountMeta::readonly(slothashes.key()),
        AccountMeta::readonly(system_program.key()),
    ];

    let ix = Instruction {
        program_id: entropy_program.key(),
        accounts: &metas,
        data: &data,
    };

    let infos = [request, requester, payer, commitment, config, slothashes, system_program, entropy_program];
    invoke_signed::<8>(&ix, &infos, signer_seeds)
}

pub fn finalize(
    entropy_program: &AccountInfo,
    request: &AccountInfo,
    commitment: &AccountInfo,
    config: &AccountInfo,
) -> ProgramResult {
    let data = [discriminator::FINALIZE];
    let metas = [
        AccountMeta::writable(request.key()),
        AccountMeta::readonly(commitment.key()),
        AccountMeta::readonly(config.key()),
    ];
    let ix = Instruction {
        program_id: entropy_program.key(),
        accounts: &metas,
        data: &data,
    };
    let infos = [request, commitment, config, entropy_program];
    invoke_signed::<4>(&ix, &infos, &[])
}
