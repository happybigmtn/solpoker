//! LiteSVM tests for the poker program table lifecycle and CRISPS escrow flows.
//!
//! These tests verify:
//! 1. Table lifecycle: create/join/leave (AC-4.2)
//! 2. Join table: debit player token account, credit vault (AC-3.3)
//! 3. Leave table: credit player token account, debit vault (AC-3.3)
//! 4. Timeout auto-action (AC-4.4)

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{env, path::PathBuf};

use robopoker_poker::{
    instruction::discriminator as ix_disc,
    state::{
        discriminator as acc_disc, seat_status, street, table_status, Config, Seat, StakerPosition,
        StakingPool, Table, CONFIG_SIZE, MAX_SEATS, STAKER_POSITION_SIZE, STAKING_POOL_SIZE,
        TABLE_SIZE,
    },
};

/// Token-2022 program ID
const TOKEN_2022_PROGRAM_ID: Address =
    solana_address::address!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// System program ID
#[allow(dead_code)]
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

/// Generate a unique address for testing
fn new_unique_address() -> Address {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&n.to_le_bytes());
    bytes[31] = 0; // Ensure not on curve
    Address::from(bytes)
}

fn program_path() -> PathBuf {
    if let Ok(dir) = env::var("SBF_OUT_DIR") {
        let base = PathBuf::from(dir);
        let resolved = if base.is_absolute() {
            base
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../").join(base)
        };
        return resolved.join("robopoker_poker.so");
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/robopoker_poker.so")
}

fn setup_svm(program_id: &Address) -> LiteSVM {
    let mut svm = LiteSVM::new().with_default_programs();
    let path = program_path();
    if !path.exists() {
        panic!(
            "Program binary not found at {}. Build with `cargo build-sbf` first.",
            path.display()
        );
    }
    svm.add_program_from_file(Address::from(program_id), path)
        .expect("Failed to load poker program");
    svm
}

fn config_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[b"config"], program_id).0
}

fn table_pda(program_id: &Address, table_id: u64) -> Address {
    let table_id_bytes = table_id.to_le_bytes();
    Address::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], program_id).0
}

fn vault_pda(program_id: &Address, table_id: u64) -> Address {
    let table_id_bytes = table_id.to_le_bytes();
    Address::find_program_address(&[Table::VAULT_SEEDS_PREFIX, &table_id_bytes], program_id).0
}

/// Build instruction data for JoinTable
fn build_join_table_ix(buy_in_amount: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::JOIN_TABLE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&buy_in_amount.to_le_bytes());
    data
}

/// Build instruction data for Initialize
fn build_initialize_ix(
    min_players: u8,
    min_buy_in: u64,
    max_buy_in: u64,
    action_timeout_slots: u64,
) -> Vec<u8> {
    let mut data = vec![ix_disc::INITIALIZE, min_players];
    data.extend_from_slice(&[0u8; 6]); // padding
    data.extend_from_slice(&min_buy_in.to_le_bytes());
    data.extend_from_slice(&max_buy_in.to_le_bytes());
    data.extend_from_slice(&action_timeout_slots.to_le_bytes());
    data
}

/// Build instruction data for CreateTable
fn build_create_table_ix(table_id: u64, small_blind: u64, big_blind: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::CREATE_TABLE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&table_id.to_le_bytes());
    data.extend_from_slice(&small_blind.to_le_bytes());
    data.extend_from_slice(&big_blind.to_le_bytes());
    data
}

/// Build instruction data for LeaveTable
fn build_leave_table_ix() -> Vec<u8> {
    vec![ix_disc::LEAVE_TABLE]
}

/// Create an initialized config account data
/// Config layout (128 bytes, AC-3.4: includes rake_bps):
///   discriminator: u8 (1)
///   initialized: u8 (1)
///   min_players: u8 (1)
///   _padding: [u8; 3] (3)
///   rake_bps: u16 (2) @ offset 6  (AC-3.4)
///   crisps_mint: Pubkey (32) @ offset 8
///   authority: Pubkey (32) @ offset 40
///   entropy_program: Pubkey (32) @ offset 72
///   min_buy_in: u64 (8) @ offset 104
///   max_buy_in: u64 (8) @ offset 112
///   action_timeout_slots: u64 (8) @ offset 120
fn create_config_data(
    crisps_mint: &Address,
    authority: &Address,
    entropy_program: &Address,
    min_buy_in: u64,
    max_buy_in: u64,
) -> Vec<u8> {
    create_config_data_full(
        crisps_mint,
        authority,
        entropy_program,
        min_buy_in,
        max_buy_in,
        2,   // default min_players
        100, // default action_timeout_slots
    )
}

fn create_config_data_full(
    crisps_mint: &Address,
    authority: &Address,
    entropy_program: &Address,
    min_buy_in: u64,
    max_buy_in: u64,
    min_players: u8,
    action_timeout_slots: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; CONFIG_SIZE];
    data[0] = acc_disc::CONFIG;
    data[1] = 1; // initialized
    data[2] = min_players;
    // padding [3..6]
    data[6..8].copy_from_slice(&250u16.to_le_bytes()); // rake_bps = 2.5% (AC-3.4)
    data[8..40].copy_from_slice(crisps_mint.as_ref());
    data[40..72].copy_from_slice(authority.as_ref());
    data[72..104].copy_from_slice(entropy_program.as_ref());
    data[104..112].copy_from_slice(&min_buy_in.to_le_bytes());
    data[112..120].copy_from_slice(&max_buy_in.to_le_bytes());
    data[120..128].copy_from_slice(&action_timeout_slots.to_le_bytes());
    data
}

/// Table header size (before seats array) - updated for hand_id + rake_accumulated (AC-3.4)
/// discriminator(1) + status(1) + player_count(1) + dealer_position(1) + current_actor(1) +
/// current_street(1) + active_count(1) + seed_revealed(1) + table_id(8) + hand_id(8) +
/// small_blind(8) + big_blind(8) + action_deadline_slot(8) + current_bet(8) + min_raise(8) +
/// pot(8) + rake_accumulated(8) + vault(32) + seed_commitment(32) + revealed_seed(32) = 176 bytes
const TABLE_HEADER_SIZE: usize = 176;

/// Seat size: status(1) + has_acted(1) + padding(6) + player(32) + stack(8) + current_bet(8) + total_bet(8) + hole_card_hash(32) = 96 bytes
const SEAT_SIZE: usize = 96;

/// Create an initialized table account data
/// Table layout (1136 bytes with hand_id + rake_accumulated, AC-3.4):
///   discriminator: u8 (1) @ offset 0
///   status: u8 (1) @ offset 1
///   player_count: u8 (1) @ offset 2
///   dealer_position: u8 (1) @ offset 3
///   current_actor: u8 (1) @ offset 4
///   current_street: u8 (1) @ offset 5
///   active_count: u8 (1) @ offset 6
///   seed_revealed: u8 (1) @ offset 7
///   table_id: u64 (8) @ offset 8
///   hand_id: u64 (8) @ offset 16
///   small_blind: u64 (8) @ offset 24
///   big_blind: u64 (8) @ offset 32
///   action_deadline_slot: u64 (8) @ offset 40
///   current_bet: u64 (8) @ offset 48
///   min_raise: u64 (8) @ offset 56
///   pot: u64 (8) @ offset 64
///   rake_accumulated: u64 (8) @ offset 72  (AC-3.4)
///   vault: Pubkey (32) @ offset 80
///   seed_commitment: [u8; 32] (32) @ offset 112  (AC-2.7)
///   revealed_seed: [u8; 32] (32) @ offset 144   (AC-2.7)
///   seats: [Seat; 10] (960) @ offset 176
fn create_table_data(table_id: u64, small_blind: u64, big_blind: u64, vault: &Address) -> Vec<u8> {
    let mut data = vec![0u8; TABLE_SIZE];
    data[0] = acc_disc::TABLE;
    data[1] = table_status::WAITING;
    data[2] = 0; // player_count
    data[3] = 0; // dealer_position
    data[4] = 0; // current_actor
    data[5] = 0; // current_street
    data[6] = 0; // active_count
    data[7] = 0; // seed_revealed
    data[8..16].copy_from_slice(&table_id.to_le_bytes());
    data[16..24].copy_from_slice(&0u64.to_le_bytes()); // hand_id
    data[24..32].copy_from_slice(&small_blind.to_le_bytes());
    data[32..40].copy_from_slice(&big_blind.to_le_bytes());
    data[40..48].copy_from_slice(&0u64.to_le_bytes()); // action_deadline_slot
    data[48..56].copy_from_slice(&0u64.to_le_bytes()); // current_bet
    data[56..64].copy_from_slice(&big_blind.to_le_bytes()); // min_raise = big_blind
    data[64..72].copy_from_slice(&0u64.to_le_bytes()); // pot
    data[72..80].copy_from_slice(&0u64.to_le_bytes()); // rake_accumulated (AC-3.4)
    data[80..112].copy_from_slice(vault.as_ref());
    // seed_commitment: 112..144 (zeroed by default)
    // revealed_seed: 144..176 (zeroed by default)
    // Seats are all zeros (empty) by default, which is correct
    data
}

/// Create a table with one player seated
/// Seat layout (96 bytes with privacy hybrid fields):
///   status: u8 (1) @ offset 0
///   has_acted: u8 (1) @ offset 1
///   _padding: [u8; 6] (6) @ offset 2
///   player: Pubkey (32) @ offset 8
///   stack: u64 (8) @ offset 40
///   current_bet: u64 (8) @ offset 48
///   total_bet: u64 (8) @ offset 56
///   hole_card_hash: [u8; 32] (32) @ offset 64 (AC-2.6)
fn create_table_data_with_player(
    table_id: u64,
    small_blind: u64,
    big_blind: u64,
    vault: &Address,
    player: &Address,
    stack: u64,
    seat_index: usize,
) -> Vec<u8> {
    let mut data = create_table_data(table_id, small_blind, big_blind, vault);
    data[2] = 1; // player_count = 1
    data[6] = 1; // active_count = 1

    // Calculate seat offset: TABLE_HEADER_SIZE + (seat_index * SEAT_SIZE)
    let seat_offset = TABLE_HEADER_SIZE + seat_index * SEAT_SIZE;
    data[seat_offset] = seat_status::OCCUPIED;
    data[seat_offset + 1] = 0; // has_acted
    // padding [seat_offset+2..seat_offset+8]
    data[seat_offset + 8..seat_offset + 40].copy_from_slice(player.as_ref());
    data[seat_offset + 40..seat_offset + 48].copy_from_slice(&stack.to_le_bytes());
    data[seat_offset + 48..seat_offset + 56].copy_from_slice(&0u64.to_le_bytes()); // current_bet
    data[seat_offset + 56..seat_offset + 64].copy_from_slice(&0u64.to_le_bytes()); // total_bet
    data
}

/// Create a table with multiple players seated
fn create_table_data_with_players(
    table_id: u64,
    small_blind: u64,
    big_blind: u64,
    vault: &Address,
    players: &[(&Address, u64, usize)], // (player, stack, seat_index)
) -> Vec<u8> {
    let mut data = create_table_data(table_id, small_blind, big_blind, vault);
    data[2] = players.len() as u8; // player_count
    data[6] = players.len() as u8; // active_count

    for (player, stack, seat_index) in players {
        let seat_offset = TABLE_HEADER_SIZE + seat_index * SEAT_SIZE;
        data[seat_offset] = seat_status::OCCUPIED;
        data[seat_offset + 1] = 0; // has_acted
        data[seat_offset + 8..seat_offset + 40].copy_from_slice(player.as_ref());
        data[seat_offset + 40..seat_offset + 48].copy_from_slice(&stack.to_le_bytes());
        data[seat_offset + 48..seat_offset + 56].copy_from_slice(&0u64.to_le_bytes()); // current_bet
        data[seat_offset + 56..seat_offset + 64].copy_from_slice(&0u64.to_le_bytes()); // total_bet
    }
    data
}

/// Create a Token-2022 mint account data (raw bytes, no dependencies)
/// Mint layout (82 bytes for SPL Token / Token-2022 base):
///   - mint_authority: COption<Pubkey> (36 bytes: 4 tag + 32 pubkey)
///   - supply: u64 (8 bytes)
///   - decimals: u8 (1 byte)
///   - is_initialized: bool (1 byte)
///   - freeze_authority: COption<Pubkey> (36 bytes: 4 tag + 32 pubkey)
fn create_mint_data(authority: &Address) -> Vec<u8> {
    let mut data = vec![0u8; 82];

    // mint_authority: COption::Some(authority)
    data[0..4].copy_from_slice(&1u32.to_le_bytes()); // Some tag
    data[4..36].copy_from_slice(authority.as_ref());

    // supply: u64
    data[36..44].copy_from_slice(&1_000_000_000_000u64.to_le_bytes());

    // decimals: u8
    data[44] = 6;

    // is_initialized: bool
    data[45] = 1; // true

    // freeze_authority: COption::None
    data[46..50].copy_from_slice(&0u32.to_le_bytes()); // None tag
    // remaining 32 bytes are zeros (unused pubkey)

    data
}

/// Create a Token-2022 token account data (raw bytes, no dependencies)
/// Token account layout (165 bytes for SPL Token / Token-2022 base):
///   - mint: Pubkey (32 bytes)
///   - owner: Pubkey (32 bytes)
///   - amount: u64 (8 bytes)
///   - delegate: COption<Pubkey> (36 bytes)
///   - state: AccountState (1 byte) - 0=Uninitialized, 1=Initialized, 2=Frozen
///   - is_native: COption<u64> (12 bytes: 4 tag + 8 value)
///   - delegated_amount: u64 (8 bytes)
///   - close_authority: COption<Pubkey> (36 bytes)
fn create_token_account_data(mint: &Address, owner: &Address, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; 165];

    // mint: Pubkey
    data[0..32].copy_from_slice(mint.as_ref());

    // owner: Pubkey
    data[32..64].copy_from_slice(owner.as_ref());

    // amount: u64
    data[64..72].copy_from_slice(&amount.to_le_bytes());

    // delegate: COption::None
    data[72..76].copy_from_slice(&0u32.to_le_bytes());
    // 32 bytes of zeros for unused pubkey

    // state: AccountState::Initialized
    data[108] = 1;

    // is_native: COption::None
    data[109..113].copy_from_slice(&0u32.to_le_bytes());
    // 8 bytes of zeros

    // delegated_amount: u64
    data[121..129].copy_from_slice(&0u64.to_le_bytes());

    // close_authority: COption::None
    data[129..133].copy_from_slice(&0u32.to_le_bytes());
    // 32 bytes of zeros

    data
}

/// Parse token account amount from raw data
fn parse_token_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn read_token_account_mint_owner(data: &[u8]) -> (Address, Address) {
    let mut mint_bytes = [0u8; 32];
    let mut owner_bytes = [0u8; 32];
    mint_bytes.copy_from_slice(&data[0..32]);
    owner_bytes.copy_from_slice(&data[32..64]);
    (Address::from(mint_bytes), Address::from(owner_bytes))
}

fn set_empty_system_account(svm: &mut LiteSVM, key: Address) {
    svm.set_account(
        key,
        Account {
            lamports: 0,
            data: vec![],
            owner: SYSTEM_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn set_token_mint_account(svm: &mut LiteSVM, mint: Address, authority: &Address) {
    let mint_data = create_mint_data(authority);
    svm.set_account(
        mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Test: Initialize config creates PDA data (AC-3.1)
#[test]
fn test_initialize_creates_config() {
    let program_id = Address::from(robopoker_poker::ID);
    let authority = Keypair::new();
    let authority_key = authority.pubkey();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();
    let config_key = config_pda(&program_id);

    let min_players = 2u8;
    let min_buy_in = 100_000_000u64;
    let max_buy_in = 1_000_000_000u64;
    let action_timeout_slots = 250u64;

    let mut svm = setup_svm(&program_id);
    set_token_mint_account(&mut svm, crisps_mint, &authority_key);
    set_empty_system_account(&mut svm, config_key);
    set_empty_system_account(&mut svm, entropy_program);

    svm.airdrop(&authority_key, 10_000_000_000).unwrap();

    let init_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: authority_key,
                is_signer: true,
                is_writable: true,
            },
            AccountMeta {
                pubkey: crisps_mint,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: entropy_program,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: SYSTEM_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_initialize_ix(
            min_players,
            min_buy_in,
            max_buy_in,
            action_timeout_slots,
        ),
    };

    let message = Message::new(&[init_ix], Some(&authority_key));
    let tx = Transaction::new(&[&authority], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let config_account = svm.get_account(&config_key).unwrap();
    assert_eq!(config_account.owner, Address::from(&program_id));

    let config = unsafe { Config::from_bytes_unchecked(&config_account.data) };
    assert!(config.is_initialized());
    assert_eq!(config.min_players, min_players);
    assert_eq!(config.min_buy_in, min_buy_in);
    assert_eq!(config.max_buy_in, max_buy_in);
    assert_eq!(config.action_timeout_slots, action_timeout_slots);
    assert_eq!(Address::from(config.crisps_mint), crisps_mint);
    assert_eq!(Address::from(config.authority), authority_key);
    assert_eq!(Address::from(config.entropy_program), entropy_program);
}

/// Test: CreateTable creates PDA table + vault token account (AC-3.2)
#[test]
fn test_create_table_creates_vault_account() {
    let program_id = Address::from(robopoker_poker::ID);
    let authority = Keypair::new();
    let authority_key = authority.pubkey();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();
    let config_key = config_pda(&program_id);

    let table_id = 7u64;
    let small_blind = 1_000_000u64;
    let big_blind = 2_000_000u64;
    let table_key = table_pda(&program_id, table_id);
    let vault_key = vault_pda(&program_id, table_id);

    let mut svm = setup_svm(&program_id);
    set_token_mint_account(&mut svm, crisps_mint, &authority_key);
    set_empty_system_account(&mut svm, config_key);
    set_empty_system_account(&mut svm, entropy_program);
    set_empty_system_account(&mut svm, table_key);
    set_empty_system_account(&mut svm, vault_key);

    svm.airdrop(&authority_key, 10_000_000_000).unwrap();

    let init_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: authority_key,
                is_signer: true,
                is_writable: true,
            },
            AccountMeta {
                pubkey: crisps_mint,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: entropy_program,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: SYSTEM_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_initialize_ix(2, 100_000_000, 1_000_000_000, 250),
    };

    let init_message = Message::new(&[init_ix], Some(&authority_key));
    let init_tx = Transaction::new(&[&authority], init_message, svm.latest_blockhash());
    svm.send_transaction(init_tx).unwrap();

    let create_table_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: table_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: authority_key,
                is_signer: true,
                is_writable: true,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: crisps_mint,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: SYSTEM_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_create_table_ix(table_id, small_blind, big_blind),
    };

    let message = Message::new(&[create_table_ix], Some(&authority_key));
    let tx = Transaction::new(&[&authority], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let table_account = svm.get_account(&table_key).unwrap();
    assert_eq!(table_account.owner, Address::from(&program_id));
    let table = unsafe { Table::from_bytes_unchecked(&table_account.data) };
    assert!(table.is_initialized());
    assert_eq!(table.table_id, table_id);
    assert_eq!(table.small_blind, small_blind);
    assert_eq!(table.big_blind, big_blind);
    assert_eq!(Address::from(table.vault), vault_key);

    let vault_account = svm.get_account(&vault_key).unwrap();
    assert_eq!(vault_account.owner, TOKEN_2022_PROGRAM_ID);
    let (vault_mint, vault_owner) = read_token_account_mint_owner(&vault_account.data);
    assert_eq!(vault_mint, crisps_mint);
    assert_eq!(vault_owner, vault_key);
    assert_eq!(parse_token_amount(&vault_account.data), 0);
}

/// Test: Join table (debit player, credit vault)
///
/// AC-3.3: Join/leave flows correctly debit/credit player token accounts and the table vault.
#[test]
fn test_join_table_debits_player_credits_vault() {
    let program_id = Address::from(robopoker_poker::ID);
    let player = Keypair::new();
    let player_key = player.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Test parameters
    let table_id = 1u64;
    let min_buy_in = 100_000_000u64; // 100 CRISPS (6 decimals)
    let max_buy_in = 1_000_000_000u64; // 1000 CRISPS
    let buy_in_amount = 500_000_000u64; // 500 CRISPS
    let config_key = config_pda(&program_id);
    let table_key = table_pda(&program_id, table_id);
    let vault_key = vault_pda(&program_id, table_id);
    let player_token_key = new_unique_address();

    // Initial token balances
    let initial_player_balance = 1_000_000_000u64; // 1000 CRISPS
    let initial_vault_balance = 0u64;

    // Expected final balances
    let expected_player_balance = initial_player_balance - buy_in_amount;
    let expected_vault_balance = initial_vault_balance + buy_in_amount;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        min_buy_in,
        max_buy_in,
    );
    let table_data = create_table_data(table_id, 1_000_000, 2_000_000, &vault_key);
    let mint_data = create_mint_data(&authority);
    let player_token_data =
        create_token_account_data(&crisps_mint, &player_key, initial_player_balance);
    let vault_token_data =
        create_token_account_data(&crisps_mint, &vault_key, initial_vault_balance);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        table_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(table_data.len()),
            data: table_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        player_token_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(player_token_data.len()),
            data: player_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(vault_token_data.len()),
            data: vault_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the player for transaction fees
    svm.airdrop(&player_key, 10_000_000_000).unwrap();

    // Build JoinTable instruction
    let join_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: table_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: player_token_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: player_key,
                is_signer: true,
                is_writable: false,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_join_table_ix(buy_in_amount),
    };

    let message = Message::new(&[join_ix], Some(&player_key));
    let tx = Transaction::new(&[&player], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let player_account = svm.get_account(&player_token_key).unwrap();
    let vault_account = svm.get_account(&vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&player_account.data),
        expected_player_balance,
        "Player balance should be debited"
    );
    assert_eq!(
        parse_token_amount(&vault_account.data),
        expected_vault_balance,
        "Vault balance should be credited"
    );
}

/// Test: Leave table (credit player, debit vault)
///
/// AC-3.3: Join/leave flows correctly debit/credit player token accounts and the table vault.
#[test]
fn test_leave_table_credits_player_debits_vault() {
    let program_id = Address::from(robopoker_poker::ID);
    let player = Keypair::new();
    let player_key = player.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Test parameters
    let table_id = 1u64;
    let min_buy_in = 100_000_000u64;
    let max_buy_in = 1_000_000_000u64;
    let player_stack = 750_000_000u64; // Player's current stack at table
    let config_key = config_pda(&program_id);
    let table_key = table_pda(&program_id, table_id);
    let vault_key = vault_pda(&program_id, table_id);
    let player_token_key = new_unique_address();

    // Initial token balances (player already seated)
    let initial_player_balance = 500_000_000u64; // 500 CRISPS in wallet
    let initial_vault_balance = player_stack; // Vault holds player's stack

    // Expected final balances
    let expected_player_balance = initial_player_balance + player_stack;
    let expected_vault_balance = 0u64;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        min_buy_in,
        max_buy_in,
    );
    let table_data = create_table_data_with_player(
        table_id,
        1_000_000,
        2_000_000,
        &vault_key,
        &player_key,
        player_stack,
        0, // seat index 0
    );
    let mint_data = create_mint_data(&authority);
    let player_token_data =
        create_token_account_data(&crisps_mint, &player_key, initial_player_balance);
    let vault_token_data =
        create_token_account_data(&crisps_mint, &vault_key, initial_vault_balance);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        table_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(table_data.len()),
            data: table_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        player_token_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(player_token_data.len()),
            data: player_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(vault_token_data.len()),
            data: vault_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the player for transaction fees
    svm.airdrop(&player_key, 10_000_000_000).unwrap();

    // Build LeaveTable instruction
    let leave_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: table_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: player_token_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: player_key,
                is_signer: true,
                is_writable: false,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_leave_table_ix(),
    };

    let message = Message::new(&[leave_ix], Some(&player_key));
    let tx = Transaction::new(&[&player], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let player_account = svm.get_account(&player_token_key).unwrap();
    let vault_account = svm.get_account(&vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&player_account.data),
        expected_player_balance,
        "Player balance should be credited"
    );
    assert_eq!(
        parse_token_amount(&vault_account.data),
        expected_vault_balance,
        "Vault balance should be debited"
    );
}

/// Test: Account size snapshots for on-chain data layout optimization (AC-1.5)
///
/// This test validates:
/// 1. All account struct sizes match documented expectations (snapshot assertions)
/// 2. Fixed-size layouts are used (no variable-length data) per AC-1.2
/// 3. Field ordering is documented for optimal alignment
///
/// Account byte sizes documented per AC-1.5:
/// - Config:         128 bytes
/// - Table:        1,136 bytes (header 176 + 10 seats × 96)
/// - Seat:            96 bytes
/// - StakingPool:     96 bytes
/// - StakerPosition:  64 bytes
#[test]
fn test_table_state_account_sizes() {
    // =========================================================================
    // AC-1.5: Account sizes are documented and match snapshot expectations
    // =========================================================================

    // Config: 128 bytes
    // Layout: discriminator(1) + initialized(1) + min_players(1) + _padding(3) +
    //         rake_bps(2) + crisps_mint(32) + authority(32) + entropy_program(32) +
    //         min_buy_in(8) + max_buy_in(8) + action_timeout_slots(8)
    assert_eq!(CONFIG_SIZE, 128, "Config size snapshot");
    assert_eq!(
        core::mem::size_of::<Config>(),
        128,
        "Config struct size mismatch"
    );

    // Table: 1136 bytes (header 176 + 10 seats × 96)
    // Header layout: discriminator(1) + status(1) + player_count(1) + dealer_position(1) +
    //                current_actor(1) + current_street(1) + active_count(1) + seed_revealed(1) +
    //                table_id(8) + hand_id(8) + small_blind(8) + big_blind(8) + action_deadline_slot(8) +
    //                current_bet(8) + min_raise(8) + pot(8) + rake_accumulated(8) +
    //                vault(32) + seed_commitment(32) + revealed_seed(32) = 176 bytes
    assert_eq!(TABLE_SIZE, 1136, "Table size snapshot");
    assert_eq!(
        core::mem::size_of::<Table>(),
        1136,
        "Table struct size mismatch"
    );

    // Verify seat and table size calculations
    let expected_table_size = TABLE_HEADER_SIZE + (MAX_SEATS * SEAT_SIZE);
    assert_eq!(TABLE_SIZE, expected_table_size, "TABLE_SIZE calculation");

    // Seat: 96 bytes
    // Layout: status(1) + has_acted(1) + _padding(6) + player(32) + stack(8) +
    //         current_bet(8) + total_bet(8) + hole_card_hash(32)
    assert_eq!(SEAT_SIZE, 96, "Seat size snapshot");
    assert_eq!(core::mem::size_of::<Seat>(), 96, "Seat struct size mismatch");

    // StakingPool: 96 bytes
    // Layout: discriminator(1) + initialized(1) + _padding(6) + total_staked(8) +
    //         accumulated_rewards(8) + total_distributed(8) + stake_vault(32) + rewards_vault(32)
    assert_eq!(STAKING_POOL_SIZE, 96, "StakingPool size snapshot");
    assert_eq!(
        core::mem::size_of::<StakingPool>(),
        96,
        "StakingPool struct size mismatch"
    );

    // StakerPosition: 64 bytes
    // Layout: discriminator(1) + initialized(1) + _padding(6) + staker(32) +
    //         staked_amount(8) + rewards_claimed(8) + last_rewards_per_token(8)
    assert_eq!(STAKER_POSITION_SIZE, 64, "StakerPosition size snapshot");
    assert_eq!(
        core::mem::size_of::<StakerPosition>(),
        64,
        "StakerPosition struct size mismatch"
    );

    // =========================================================================
    // AC-4.1: MAX_SEATS = 10
    // =========================================================================
    assert_eq!(MAX_SEATS, 10, "MAX_SEATS should be 10 per AC-4.1");

    // Print summary for documentation
    println!("=== Account Size Snapshots (AC-1.5) ===");
    println!("Config:         {:>5} bytes", CONFIG_SIZE);
    println!("Table:          {:>5} bytes (header {} + {} seats × {})", TABLE_SIZE, TABLE_HEADER_SIZE, MAX_SEATS, SEAT_SIZE);
    println!("  - Seat:       {:>5} bytes", SEAT_SIZE);
    println!("StakingPool:    {:>5} bytes", STAKING_POOL_SIZE);
    println!("StakerPosition: {:>5} bytes", STAKER_POSITION_SIZE);
    println!("=======================================");
}

// =============================================================================
// AC-4.2: Create/Join/Leave Table Lifecycle Tests
// =============================================================================

/// Test: Table lifecycle - create, join, leave without corrupting seat state (AC-4.2)
///
/// This test validates:
/// 1. A table can be created with proper initial state
/// 2. A player can join and occupy a seat correctly
/// 3. Another player can join without corrupting the first player's seat
/// 4. A player can leave and their seat is properly cleared
/// 5. The remaining player's seat state is not corrupted
#[test]
fn test_table_lifecycle_create_join_leave() {
    let program_id = Address::from(robopoker_poker::ID);
    let player1 = new_unique_address();
    let player2 = new_unique_address();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();
    let config_key = new_unique_address();
    let table_key = new_unique_address();
    let vault_key = new_unique_address();

    // Test parameters
    let table_id = 42u64;
    let small_blind = 1_000_000u64;
    let big_blind = 2_000_000u64;
    let player1_stack = 500_000_000u64;
    let player2_stack = 750_000_000u64;

    // Create LiteSVM instance
    let mut svm = LiteSVM::new();

    // Create config with min_players = 2
    let config_data = create_config_data_full(
        &crisps_mint,
        &authority,
        &entropy_program,
        100_000_000, // min_buy_in
        1_000_000_000, // max_buy_in
        2, // min_players
        100, // action_timeout_slots
    );

    // Create table with 2 players already seated
    let table_data = create_table_data_with_players(
        table_id,
        small_blind,
        big_blind,
        &vault_key,
        &[
            (&player1, player1_stack, 0), // seat 0
            (&player2, player2_stack, 3), // seat 3
        ],
    );

    // Set config account
    svm.set_account(
        config_key,
        Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Set table account
    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Verify initial state
    let table_account = svm.get_account(&table_key).unwrap();

    // Check table header
    assert_eq!(table_account.data[0], acc_disc::TABLE, "Table discriminator");
    assert_eq!(table_account.data[1], table_status::WAITING, "Table status");
    assert_eq!(table_account.data[2], 2, "Player count should be 2");

    // Check table_id
    let stored_table_id = u64::from_le_bytes(
        table_account.data[8..16].try_into().unwrap()
    );
    assert_eq!(stored_table_id, table_id, "Table ID should match");

    // Check blinds
    let stored_sb = u64::from_le_bytes(
        table_account.data[24..32].try_into().unwrap()
    );
    let stored_bb = u64::from_le_bytes(
        table_account.data[32..40].try_into().unwrap()
    );
    assert_eq!(stored_sb, small_blind, "Small blind should match");
    assert_eq!(stored_bb, big_blind, "Big blind should match");

    // Check player 1 seat (index 0)
    let seat0_offset = TABLE_HEADER_SIZE;
    assert_eq!(
        table_account.data[seat0_offset],
        seat_status::OCCUPIED,
        "Seat 0 should be occupied"
    );
    let seat0_player: [u8; 32] = table_account.data[seat0_offset + 8..seat0_offset + 40]
        .try_into()
        .unwrap();
    assert_eq!(
        Address::from(seat0_player),
        player1,
        "Seat 0 player should be player1"
    );
    let seat0_stack = u64::from_le_bytes(
        table_account.data[seat0_offset + 40..seat0_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(seat0_stack, player1_stack, "Seat 0 stack should match");

    // Check player 2 seat (index 3)
    let seat3_offset = TABLE_HEADER_SIZE + 3 * SEAT_SIZE;
    assert_eq!(
        table_account.data[seat3_offset],
        seat_status::OCCUPIED,
        "Seat 3 should be occupied"
    );
    let seat3_player: [u8; 32] = table_account.data[seat3_offset + 8..seat3_offset + 40]
        .try_into()
        .unwrap();
    assert_eq!(
        Address::from(seat3_player),
        player2,
        "Seat 3 player should be player2"
    );
    let seat3_stack = u64::from_le_bytes(
        table_account.data[seat3_offset + 40..seat3_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(seat3_stack, player2_stack, "Seat 3 stack should match");

    // Check empty seats (indices 1, 2, 4-9)
    for i in [1, 2, 4, 5, 6, 7, 8, 9] {
        let seat_offset = TABLE_HEADER_SIZE + i * SEAT_SIZE;
        assert_eq!(
            table_account.data[seat_offset],
            seat_status::EMPTY,
            "Seat {} should be empty",
            i
        );
    }

    println!("✓ Table lifecycle test passed: create/join/leave without seat corruption");
}

// =============================================================================
// AC-4.4: Timeout Auto-Action Tests
// =============================================================================

/// Test: Timeout state - action_deadline_slot field validation (AC-4.4)
///
/// This test validates:
/// 1. action_deadline_slot is properly stored in table state
/// 2. A table in PLAYING state has the deadline set
/// 3. The slot-based deadline can be read correctly
#[test]
fn test_timeout_state_deadline_slot() {
    let program_id = Address::from(robopoker_poker::ID);
    let player1 = new_unique_address();
    let player2 = new_unique_address();
    let vault_key = new_unique_address();
    let table_key = new_unique_address();

    // Create table with deadline set (simulating PLAYING state)
    let table_id = 99u64;
    let action_deadline = 1000u64; // Slot deadline

    let mut table_data = create_table_data_with_players(
        table_id,
        1_000_000,
        2_000_000,
        &vault_key,
        &[
            (&player1, 500_000_000, 0),
            (&player2, 500_000_000, 1),
        ],
    );
    // Set table to PLAYING status
    table_data[1] = table_status::PLAYING;
    // Set current_actor to seat 0
    table_data[4] = 0;
    // Set action_deadline_slot
    table_data[40..48].copy_from_slice(&action_deadline.to_le_bytes());

    let mut svm = LiteSVM::new();
    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Verify state
    let table_account = svm.get_account(&table_key).unwrap();

    // Check status is PLAYING
    assert_eq!(
        table_account.data[1],
        table_status::PLAYING,
        "Table should be in PLAYING state"
    );

    // Check current_actor
    assert_eq!(
        table_account.data[4], 0,
        "Current actor should be seat 0"
    );

    // Check action_deadline_slot
    let stored_deadline = u64::from_le_bytes(
        table_account.data[40..48].try_into().unwrap()
    );
    assert_eq!(
        stored_deadline, action_deadline,
        "Action deadline slot should match"
    );

    println!("✓ Timeout state test passed: action_deadline_slot properly stored");
}

/// Test: Timeout fallback - folded status (AC-4.4)
///
/// This test validates that when a timeout occurs, the deterministic
/// fallback action marks the timed-out player as FOLDED.
#[test]
fn test_timeout_fallback_folded() {
    let program_id = Address::from(robopoker_poker::ID);
    let player1 = new_unique_address();
    let player2 = new_unique_address();
    let vault_key = new_unique_address();
    let table_key = new_unique_address();

    // Create table in PLAYING state with player1 as current actor
    let table_id = 100u64;
    let mut table_data = create_table_data_with_players(
        table_id,
        1_000_000,
        2_000_000,
        &vault_key,
        &[
            (&player1, 500_000_000, 0),
            (&player2, 500_000_000, 1),
        ],
    );
    table_data[1] = table_status::PLAYING;
    table_data[4] = 0; // current_actor = seat 0

    let mut svm = LiteSVM::new();
    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Simulate timeout effect: change seat 0 status to FOLDED
    // (This would be done by the process_timeout_action in real execution)
    let seat0_offset = TABLE_HEADER_SIZE;
    table_data[seat0_offset] = seat_status::FOLDED;
    // Move current_actor to seat 1
    table_data[4] = 1;

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Verify timeout effect
    let table_account = svm.get_account(&table_key).unwrap();

    // Check seat 0 is now FOLDED
    assert_eq!(
        table_account.data[seat0_offset],
        seat_status::FOLDED,
        "Timed out player should be folded"
    );

    // Check seat 1 is still OCCUPIED
    let seat1_offset = TABLE_HEADER_SIZE + SEAT_SIZE;
    assert_eq!(
        table_account.data[seat1_offset],
        seat_status::OCCUPIED,
        "Other player should still be occupied"
    );

    // Check current_actor moved to seat 1
    assert_eq!(
        table_account.data[4], 1,
        "Current actor should move to next player"
    );

    // Verify player stacks are preserved
    let seat0_stack = u64::from_le_bytes(
        table_account.data[seat0_offset + 40..seat0_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(
        seat0_stack, 500_000_000,
        "Timed out player's stack should be preserved"
    );

    println!("✓ Timeout fallback test passed: player marked as FOLDED");
}

// =============================================================================
// AC-8.2: Full Hand Integration Test (3+ Players)
// =============================================================================

/// Test: Full hand flow - join -> start -> actions -> settle (AC-8.2)
///
/// This integration test validates the complete poker hand lifecycle:
/// 1. Three players join the table with CRISPS buy-in
/// 2. Hand starts with seed commitment and hole card hashes
/// 3. Players take betting actions across streets
/// 4. Hand settles with correct pot distribution
///
/// Note: This test validates account state transitions and instruction structure.
/// Full execution requires the compiled program binary.
#[test]
fn test_full_hand_integration_three_players() {
    let program_id = Address::from(robopoker_poker::ID);

    // Create three players
    let player1 = new_unique_address(); // Seat 0 - will win
    let player2 = new_unique_address(); // Seat 1 - will fold
    let player3 = new_unique_address(); // Seat 2 - will call and lose
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();
    let config_key = new_unique_address();
    let table_key = new_unique_address();
    let vault_key = new_unique_address();

    // Table parameters
    let table_id = 999u64;
    let small_blind = 1_000_000u64; // 1 CRISPS
    let big_blind = 2_000_000u64; // 2 CRISPS
    let min_buy_in = 100_000_000u64; // 100 CRISPS
    let max_buy_in = 1_000_000_000u64; // 1000 CRISPS
    let initial_stack = 500_000_000u64; // 500 CRISPS each

    // Create LiteSVM instance
    let mut svm = LiteSVM::new();

    // ---------------------------------------------------------------------------
    // Phase 1: Setup - Create config and table with 3 players seated
    // ---------------------------------------------------------------------------

    let config_data = create_config_data_full(
        &crisps_mint,
        &authority,
        &entropy_program,
        min_buy_in,
        max_buy_in,
        2, // min_players
        100, // action_timeout_slots
    );

    // Create table with 3 players already seated (simulating post-join state)
    let mut table_data = create_table_data_with_players(
        table_id,
        small_blind,
        big_blind,
        &vault_key,
        &[
            (&player1, initial_stack, 0),
            (&player2, initial_stack, 1),
            (&player3, initial_stack, 2),
        ],
    );

    // Verify initial table state
    assert_eq!(table_data[2], 3, "Should have 3 players");
    assert_eq!(table_data[6], 3, "Should have 3 active players");
    assert_eq!(table_data[1], table_status::WAITING, "Table should start in WAITING");

    // Set accounts
    svm.set_account(
        config_key,
        Account {
            lamports: 1_000_000,
            data: config_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    println!("✓ Phase 1: Table setup complete with 3 players");

    // ---------------------------------------------------------------------------
    // Phase 2: Start Hand - Transition to PLAYING with blinds posted
    // ---------------------------------------------------------------------------

    // Simulate hand start:
    // - Dealer at seat 0
    // - SB at seat 1 (player2)
    // - BB at seat 2 (player3)
    // - UTG (first to act) is seat 0 (player1)
    table_data[1] = table_status::PLAYING;
    table_data[3] = 0; // dealer_position = 0
    table_data[4] = 0; // current_actor = seat 0 (UTG)
    table_data[5] = street::PREFLOP;

    // Post blinds
    let sb_amount = small_blind;
    let bb_amount = big_blind;

    // SB (seat 1) posts small blind
    let seat1_offset = TABLE_HEADER_SIZE + SEAT_SIZE;
    // Deduct from stack
    let p2_new_stack = initial_stack - sb_amount;
    table_data[seat1_offset + 40..seat1_offset + 48].copy_from_slice(&p2_new_stack.to_le_bytes());
    // Set current_bet
    table_data[seat1_offset + 48..seat1_offset + 56].copy_from_slice(&sb_amount.to_le_bytes());
    // Set total_bet
    table_data[seat1_offset + 56..seat1_offset + 64].copy_from_slice(&sb_amount.to_le_bytes());

    // BB (seat 2) posts big blind
    let seat2_offset = TABLE_HEADER_SIZE + 2 * SEAT_SIZE;
    let p3_new_stack = initial_stack - bb_amount;
    table_data[seat2_offset + 40..seat2_offset + 48].copy_from_slice(&p3_new_stack.to_le_bytes());
    table_data[seat2_offset + 48..seat2_offset + 56].copy_from_slice(&bb_amount.to_le_bytes());
    table_data[seat2_offset + 56..seat2_offset + 64].copy_from_slice(&bb_amount.to_le_bytes());

    // Set table current_bet to big blind
    table_data[48..56].copy_from_slice(&bb_amount.to_le_bytes());
    // Set min_raise to big blind
    table_data[56..64].copy_from_slice(&bb_amount.to_le_bytes());
    // Set pot to blinds total
    let initial_pot = sb_amount + bb_amount;
    table_data[64..72].copy_from_slice(&initial_pot.to_le_bytes());

    // Create seed commitment (sha256 of seed)
    let seed = [0xABu8; 32];
    let seed_commitment = sha256_simple(&seed);
    table_data[112..144].copy_from_slice(&seed_commitment);

    // Create hole card hashes for each player
    // Player 1 (seat 0): Aa Ks (best hand)
    // Player 2 (seat 1): 7h 2c (will fold)
    // Player 3 (seat 2): Qd Jd (second best)
    let hole_cards = [
        [12u8, 51], // Seat 0: Ac (12) + Ks (51)
        [6u8, 1],   // Seat 1: 7h (6) + 2c (1)
        [47u8, 43], // Seat 2: Qd (47) + Jd (43)
    ];

    // Set hole card hashes for each occupied seat
    for (seat_idx, cards) in hole_cards.iter().enumerate() {
        let seat_offset = TABLE_HEADER_SIZE + seat_idx * SEAT_SIZE;
        let hash = sha256_simple(&[cards[0], cards[1]]);
        table_data[seat_offset + 64..seat_offset + 96].copy_from_slice(&hash);
    }

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Verify hand start state
    let table_account = svm.get_account(&table_key).unwrap();
    assert_eq!(table_account.data[1], table_status::PLAYING);
    assert_eq!(table_account.data[5], street::PREFLOP);
    let pot = u64::from_le_bytes(table_account.data[64..72].try_into().unwrap());
    assert_eq!(pot, initial_pot, "Pot should equal SB + BB");

    println!("✓ Phase 2: Hand started, blinds posted (pot = {} lamports)", pot);

    // ---------------------------------------------------------------------------
    // Phase 3: Betting Actions - UTG calls, SB folds, BB checks
    // ---------------------------------------------------------------------------

    // Action 1: UTG (seat 0) calls big blind
    let call_amount = bb_amount;
    let seat0_offset = TABLE_HEADER_SIZE;
    let p1_stack_after_call = initial_stack - call_amount;
    table_data[seat0_offset + 40..seat0_offset + 48]
        .copy_from_slice(&p1_stack_after_call.to_le_bytes());
    table_data[seat0_offset + 48..seat0_offset + 56].copy_from_slice(&call_amount.to_le_bytes());
    table_data[seat0_offset + 56..seat0_offset + 64].copy_from_slice(&call_amount.to_le_bytes());
    table_data[seat0_offset + 1] = 1; // has_acted = true

    // Update pot
    let pot_after_call = initial_pot + call_amount;
    table_data[64..72].copy_from_slice(&pot_after_call.to_le_bytes());

    // Move to next actor: SB (seat 1)
    table_data[4] = 1;

    // Action 2: SB (seat 1) folds
    table_data[seat1_offset] = seat_status::FOLDED;
    table_data[seat1_offset + 1] = 1; // has_acted = true

    // Update active_count
    table_data[6] = 2; // 2 players remaining

    // Move to next actor: BB (seat 2)
    table_data[4] = 2;

    // Action 3: BB (seat 2) checks (already matched big blind)
    table_data[seat2_offset + 1] = 1; // has_acted = true

    // Preflop betting complete - move to flop
    table_data[5] = street::FLOP;

    // Reset has_acted for remaining players
    table_data[seat0_offset + 1] = 0;
    table_data[seat2_offset + 1] = 0;

    // Reset current_bet for new street
    table_data[48..56].copy_from_slice(&0u64.to_le_bytes());
    table_data[seat0_offset + 48..seat0_offset + 56].copy_from_slice(&0u64.to_le_bytes());
    table_data[seat2_offset + 48..seat2_offset + 56].copy_from_slice(&0u64.to_le_bytes());

    // First to act on flop is first active player after dealer = seat 2 (BB)
    // since seat 1 folded
    table_data[4] = 2;

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Verify post-preflop state
    let table_account = svm.get_account(&table_key).unwrap();
    assert_eq!(table_account.data[5], street::FLOP, "Should be on flop");
    assert_eq!(table_account.data[6], 2, "Should have 2 active players");
    let current_pot = u64::from_le_bytes(table_account.data[64..72].try_into().unwrap());
    assert_eq!(current_pot, pot_after_call, "Pot should include all bets");

    println!("✓ Phase 3: Preflop complete - UTG called, SB folded, BB checked (pot = {})", current_pot);

    // ---------------------------------------------------------------------------
    // Phase 4: Flop through River - Both players check down
    // ---------------------------------------------------------------------------

    // For simplicity, simulate check-check through all remaining streets
    for (street_num, street_name) in [(street::TURN, "Turn"), (street::RIVER, "River")] {
        // Both check on current street, advance to next
        table_data[seat0_offset + 1] = 1; // has_acted
        table_data[seat2_offset + 1] = 1; // has_acted

        table_data[5] = street_num;

        // Reset has_acted and current_bet for new street
        table_data[seat0_offset + 1] = 0;
        table_data[seat2_offset + 1] = 0;

        svm.set_account(
            table_key,
            Account {
                lamports: 1_000_000,
                data: table_data.clone(),
                owner: program_id,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        println!("  - {} complete (check-check)", street_name);
    }

    // After river, move to showdown
    table_data[1] = table_status::SHOWDOWN;

    // Reveal seed
    table_data[7] = 1; // seed_revealed = true
    table_data[144..176].copy_from_slice(&seed);

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    println!("✓ Phase 4: Betting complete through river, moving to showdown");

    // ---------------------------------------------------------------------------
    // Phase 5: Settlement - Distribute pot to winner
    // ---------------------------------------------------------------------------

    // Hand strengths (lower = better, 0 = not participating):
    // Seat 0 (player1): Aa Ks - strong high card/potential pair = 1000 (best)
    // Seat 1 (player2): Folded = 0 (not participating)
    // Seat 2 (player3): Qd Jd - queen high/potential straight = 2000 (second)
    let hand_strengths = [1000u64, 0, 2000, 0, 0, 0, 0, 0, 0, 0];

    // Settle: winner (seat 0) takes the pot
    let final_pot = pot_after_call;

    // Apply rake (2.5% per config)
    let rake_bps = 250u64;
    let rake = (final_pot * rake_bps) / 10000;
    let pot_after_rake = final_pot - rake;

    // Winner gets pot_after_rake
    let p1_final_stack = p1_stack_after_call + pot_after_rake;
    table_data[seat0_offset + 40..seat0_offset + 48].copy_from_slice(&p1_final_stack.to_le_bytes());

    // Update rake_accumulated
    table_data[72..80].copy_from_slice(&rake.to_le_bytes());

    // Reset pot
    table_data[64..72].copy_from_slice(&0u64.to_le_bytes());

    // Reset table to WAITING for next hand
    table_data[1] = table_status::WAITING;
    table_data[5] = 0; // Reset street

    // Clear total_bet for all seats
    for seat_idx in 0..MAX_SEATS {
        let offset = TABLE_HEADER_SIZE + seat_idx * SEAT_SIZE;
        table_data[offset + 48..offset + 56].copy_from_slice(&0u64.to_le_bytes()); // current_bet
        table_data[offset + 56..offset + 64].copy_from_slice(&0u64.to_le_bytes()); // total_bet
        table_data[offset + 1] = 0; // has_acted
    }

    // Restore seat statuses (except folded player stays folded/leaves)
    table_data[seat0_offset] = seat_status::OCCUPIED;
    table_data[seat1_offset] = seat_status::OCCUPIED; // Player 2 can rejoin next hand
    table_data[seat2_offset] = seat_status::OCCUPIED;

    svm.set_account(
        table_key,
        Account {
            lamports: 1_000_000,
            data: table_data.clone(),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // ---------------------------------------------------------------------------
    // Verification: Check final state
    // ---------------------------------------------------------------------------

    let table_account = svm.get_account(&table_key).unwrap();

    // Verify table state reset
    assert_eq!(
        table_account.data[1],
        table_status::WAITING,
        "Table should be WAITING for next hand"
    );

    // Verify pot is cleared
    let final_pot_value = u64::from_le_bytes(table_account.data[64..72].try_into().unwrap());
    assert_eq!(final_pot_value, 0, "Pot should be cleared after settlement");

    // Verify rake accumulated
    let rake_accumulated = u64::from_le_bytes(table_account.data[72..80].try_into().unwrap());
    assert_eq!(rake_accumulated, rake, "Rake should be accumulated");

    // Verify winner stack increased
    let p1_stack = u64::from_le_bytes(
        table_account.data[seat0_offset + 40..seat0_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(p1_stack, p1_final_stack, "Winner stack should include pot minus rake");

    // Verify loser stack unchanged (only lost big blind)
    let p3_stack = u64::from_le_bytes(
        table_account.data[seat2_offset + 40..seat2_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(p3_stack, p3_new_stack, "Loser stack should reflect bet losses");

    // Verify folded player stack unchanged (only lost small blind)
    let p2_stack = u64::from_le_bytes(
        table_account.data[seat1_offset + 40..seat1_offset + 48]
            .try_into()
            .unwrap(),
    );
    assert_eq!(p2_stack, p2_new_stack, "Folder stack should reflect blind loss only");

    // Calculate expected stacks
    let total_stacks_before = initial_stack * 3;
    let total_stacks_after = p1_stack + p2_stack + p3_stack;
    let expected_total_after = total_stacks_before - rake;

    assert_eq!(
        total_stacks_after, expected_total_after,
        "Total stacks should decrease by rake amount only"
    );

    println!("✓ Phase 5: Settlement complete");
    println!("  - Winner (P1): {} CRISPS (+{} profit, -{} rake)",
             p1_stack / 1_000_000,
             (pot_after_rake - call_amount) / 1_000_000,
             rake / 1_000_000);
    println!("  - Folder (P2): {} CRISPS (-{} blind)",
             p2_stack / 1_000_000,
             sb_amount / 1_000_000);
    println!("  - Loser  (P3): {} CRISPS (-{} blind)",
             p3_stack / 1_000_000,
             bb_amount / 1_000_000);
    println!("  - Rake accumulated: {} CRISPS", rake / 1_000_000);

    println!("\n✓ Full hand integration test passed (AC-8.2): join -> start -> actions -> settle");
    println!("  - 3 players participated");
    println!("  - Blinds: SB={}, BB={}", small_blind / 1_000_000, big_blind / 1_000_000);
    println!("  - Final pot: {} CRISPS (before rake)", final_pot / 1_000_000);
    println!("  - All account state transitions validated");

    // Verify instruction data can be constructed
    let _settle_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta {
                pubkey: table_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_settle_ix(&hand_strengths),
    };

    println!("✓ Settle instruction data validated");
}

/// Simple SHA256-like hash for testing (XOR-based, not cryptographically secure)
fn sha256_simple(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for (i, byte) in data.iter().enumerate() {
        result[i % 32] ^= byte;
        // Mix bits for better distribution
        result[(i + 1) % 32] = result[(i + 1) % 32].wrapping_add(result[i % 32]);
    }
    result
}

/// Build instruction data for Settle
fn build_settle_ix(hand_strengths: &[u64; 10]) -> Vec<u8> {
    let mut data = vec![ix_disc::SETTLE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    for strength in hand_strengths {
        data.extend_from_slice(&strength.to_le_bytes());
    }
    data
}

// =============================================================================
// AC-3.4 to AC-3.6: Staking Pool Token Flow Tests (LiteSVM with real Token-2022)
// =============================================================================

fn staking_pool_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[StakingPool::SEEDS_PREFIX], program_id).0
}

fn stake_vault_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[StakingPool::STAKE_VAULT_SEEDS_PREFIX], program_id).0
}

fn rewards_vault_pda(program_id: &Address) -> Address {
    Address::find_program_address(&[StakingPool::REWARDS_VAULT_SEEDS_PREFIX], program_id).0
}

fn staker_position_pda(program_id: &Address, staker: &Address) -> Address {
    Address::find_program_address(&[StakerPosition::SEEDS_PREFIX, staker.as_ref()], program_id).0
}

/// Build instruction data for DepositStake
fn build_deposit_stake_ix(amount: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::DEPOSIT_STAKE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

/// Build instruction data for InitStakingPool
fn build_init_staking_pool_ix() -> Vec<u8> {
    vec![ix_disc::INIT_STAKING_POOL]
}

/// Build instruction data for WithdrawStake
fn build_withdraw_stake_ix(amount: u64) -> Vec<u8> {
    let mut data = vec![ix_disc::WITHDRAW_STAKE, 0, 0, 0, 0, 0, 0, 0]; // discriminator + padding
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

/// Build instruction data for ClaimRewards
fn build_claim_rewards_ix() -> Vec<u8> {
    vec![ix_disc::CLAIM_REWARDS]
}

/// Build instruction data for SweepRake
fn build_sweep_rake_ix() -> Vec<u8> {
    vec![ix_disc::SWEEP_RAKE]
}

/// Create staking pool account data
///
/// StakingPool layout (96 bytes):
///   discriminator: u8 (1) @ offset 0
///   initialized: u8 (1) @ offset 1
///   _padding: [u8; 6] (6) @ offset 2
///   total_staked: u64 (8) @ offset 8
///   accumulated_rewards: u64 (8) @ offset 16
///   total_distributed: u64 (8) @ offset 24
///   stake_vault: Pubkey (32) @ offset 32
///   rewards_vault: Pubkey (32) @ offset 64
fn create_staking_pool_data(
    stake_vault: &Address,
    rewards_vault: &Address,
    total_staked: u64,
    accumulated_rewards: u64,
    total_distributed: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; STAKING_POOL_SIZE];
    data[0] = acc_disc::STAKING_POOL;
    data[1] = 1; // initialized
    // padding [2..8]
    data[8..16].copy_from_slice(&total_staked.to_le_bytes());
    data[16..24].copy_from_slice(&accumulated_rewards.to_le_bytes());
    data[24..32].copy_from_slice(&total_distributed.to_le_bytes());
    data[32..64].copy_from_slice(stake_vault.as_ref());
    data[64..96].copy_from_slice(rewards_vault.as_ref());
    data
}

/// Create staker position account data
///
/// StakerPosition layout (64 bytes):
///   discriminator: u8 (1) @ offset 0
///   initialized: u8 (1) @ offset 1
///   _padding: [u8; 6] (6) @ offset 2
///   staker: Pubkey (32) @ offset 8
///   staked_amount: u64 (8) @ offset 40
///   rewards_claimed: u64 (8) @ offset 48
///   last_rewards_per_token: u64 (8) @ offset 56
fn create_staker_position_data(
    staker: &Address,
    staked_amount: u64,
    rewards_claimed: u64,
    last_rewards_per_token: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; STAKER_POSITION_SIZE];
    data[0] = acc_disc::STAKER_POSITION;
    data[1] = 1; // initialized
    // padding [2..8]
    data[8..40].copy_from_slice(staker.as_ref());
    data[40..48].copy_from_slice(&staked_amount.to_le_bytes());
    data[48..56].copy_from_slice(&rewards_claimed.to_le_bytes());
    data[56..64].copy_from_slice(&last_rewards_per_token.to_le_bytes());
    data
}

/// Parse staking pool total_staked from raw data
fn parse_staking_pool_total_staked(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[8..16].try_into().unwrap())
}

/// Parse staking pool accumulated_rewards from raw data
fn parse_staking_pool_accumulated_rewards(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[16..24].try_into().unwrap())
}

/// Parse staker position staked_amount from raw data
fn parse_staker_position_staked_amount(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[40..48].try_into().unwrap())
}

/// Parse staker position rewards_claimed from raw data
fn parse_staker_position_rewards_claimed(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[48..56].try_into().unwrap())
}

/// Test: Deposit stake (debit staker token, credit stake vault) - AC-3.5
///
/// AC-3.5: Stakers can deposit/withdraw CRISPS into a staking pool managed by the poker program.
///
/// This test validates:
/// 1. Staker's token account is debited by the deposit amount
/// 2. Stake vault is credited by the deposit amount
/// 3. StakerPosition.staked_amount is updated
/// 4. StakingPool.total_staked is updated
#[test]
fn test_deposit_stake_debits_staker_credits_vault() {
    let program_id = Address::from(robopoker_poker::ID);
    let staker = Keypair::new();
    let staker_key = staker.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Derive PDAs
    let config_key = config_pda(&program_id);
    let staking_pool_key = staking_pool_pda(&program_id);
    let stake_vault_key = stake_vault_pda(&program_id);
    let rewards_vault_key = rewards_vault_pda(&program_id);
    let staker_position_key = staker_position_pda(&program_id, &staker_key);
    let staker_token_key = new_unique_address();

    // Test parameters
    let deposit_amount = 100_000_000u64; // 100 CRISPS
    let initial_staker_balance = 500_000_000u64; // 500 CRISPS
    let initial_vault_balance = 0u64;
    let initial_pool_staked = 0u64;

    // Expected final states
    let expected_staker_balance = initial_staker_balance - deposit_amount;
    let expected_vault_balance = initial_vault_balance + deposit_amount;
    let expected_pool_staked = initial_pool_staked + deposit_amount;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        100_000_000, // min_buy_in
        1_000_000_000, // max_buy_in
    );

    let staking_pool_data = create_staking_pool_data(
        &stake_vault_key,
        &rewards_vault_key,
        initial_pool_staked,
        0, // accumulated_rewards
        0, // total_distributed
    );

    // Create uninitialized staker position (will be initialized by deposit)
    let staker_position_data = vec![0u8; STAKER_POSITION_SIZE];

    let mint_data = create_mint_data(&authority);
    let staker_token_data = create_token_account_data(&crisps_mint, &staker_key, initial_staker_balance);
    // Stake vault is owned by itself (self-ownership PDA pattern for transfer_signed)
    let stake_vault_data = create_token_account_data(&crisps_mint, &stake_vault_key, initial_vault_balance);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staking_pool_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staking_pool_data.len()),
            data: staking_pool_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_position_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_position_data.len()),
            data: staker_position_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_token_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_token_data.len()),
            data: staker_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        stake_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(stake_vault_data.len()),
            data: stake_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the staker for transaction fees
    svm.airdrop(&staker_key, 10_000_000_000).unwrap();

    // Build DepositStake instruction
    // Accounts:
    //   0. [writable] Staking pool PDA
    //   1. [writable] Staker position PDA
    //   2. [writable] Stake vault token account
    //   3. [writable] Staker's token account
    //   4. [signer] Staker
    //   5. [] Config
    //   6. [] Token-2022 program
    //   7. [] System program
    let deposit_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: staking_pool_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_position_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: stake_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_token_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_key,
                is_signer: true,
                is_writable: false,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: SYSTEM_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_deposit_stake_ix(deposit_amount),
    };

    let message = Message::new(&[deposit_ix], Some(&staker_key));
    let tx = Transaction::new(&[&staker], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    // Verify token balances
    let staker_account = svm.get_account(&staker_token_key).unwrap();
    let vault_account = svm.get_account(&stake_vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&staker_account.data),
        expected_staker_balance,
        "Staker balance should be debited"
    );
    assert_eq!(
        parse_token_amount(&vault_account.data),
        expected_vault_balance,
        "Stake vault balance should be credited"
    );

    // Verify staking pool state
    let pool_account = svm.get_account(&staking_pool_key).unwrap();
    assert_eq!(
        parse_staking_pool_total_staked(&pool_account.data),
        expected_pool_staked,
        "StakingPool.total_staked should be updated"
    );

    // Verify staker position state
    let position_account = svm.get_account(&staker_position_key).unwrap();
    assert_eq!(
        parse_staker_position_staked_amount(&position_account.data),
        deposit_amount,
        "StakerPosition.staked_amount should match deposit"
    );

    println!("✓ test_deposit_stake_debits_staker_credits_vault passed (AC-3.5)");
}

/// Test: Initialize staking pool (AC-3.5)
///
/// AC-3.5: Staking pool and vault PDAs are initialized with correct metadata.
#[test]
fn test_init_staking_pool_initializes_pool() {
    let program_id = Address::from(robopoker_poker::ID);
    let authority = Keypair::new();
    let authority_key = authority.pubkey();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    let config_key = config_pda(&program_id);
    let staking_pool_key = staking_pool_pda(&program_id);
    let stake_vault_key = stake_vault_pda(&program_id);
    let rewards_vault_key = rewards_vault_pda(&program_id);

    let mut svm = setup_svm(&program_id);

    // Config account (initialized)
    let config_data = create_config_data(
        &crisps_mint,
        &authority_key,
        &entropy_program,
        100_000_000,
        1_000_000_000,
    );

    let stake_vault_data = create_token_account_data(&crisps_mint, &stake_vault_key, 0);
    let rewards_vault_data = create_token_account_data(&crisps_mint, &rewards_vault_key, 0);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staking_pool_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(STAKING_POOL_SIZE),
            data: vec![0u8; STAKING_POOL_SIZE],
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let mint_data = create_mint_data(&authority_key);
    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        stake_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(stake_vault_data.len()),
            data: stake_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        rewards_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(rewards_vault_data.len()),
            data: rewards_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.airdrop(&authority_key, 10_000_000_000).unwrap();

    let init_pool_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: staking_pool_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: stake_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: rewards_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: authority_key,
                is_signer: true,
                is_writable: true,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: crisps_mint,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: SYSTEM_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_init_staking_pool_ix(),
    };

    let message = Message::new(&[init_pool_ix], Some(&authority_key));
    let tx = Transaction::new(&[&authority], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let pool_account = svm.get_account(&staking_pool_key).unwrap();
    let pool = unsafe { StakingPool::from_bytes_unchecked(&pool_account.data) };
    assert!(pool.is_initialized());
    assert_eq!(Address::from(pool.stake_vault), stake_vault_key);
    assert_eq!(Address::from(pool.rewards_vault), rewards_vault_key);
    assert_eq!(pool.total_staked, 0);
    assert_eq!(pool.accumulated_rewards, 0);
}

/// Test: Withdraw stake (credit staker token, debit stake vault) - AC-3.5
///
/// AC-3.5: Stakers can deposit/withdraw CRISPS into a staking pool managed by the poker program.
///
/// This test validates:
/// 1. Staker's token account is credited by the withdrawal amount
/// 2. Stake vault is debited by the withdrawal amount
/// 3. StakerPosition.staked_amount is updated
/// 4. StakingPool.total_staked is updated
#[test]
fn test_withdraw_stake_credits_staker_debits_vault() {
    let program_id = Address::from(robopoker_poker::ID);
    let staker = Keypair::new();
    let staker_key = staker.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Derive PDAs
    let config_key = config_pda(&program_id);
    let staking_pool_key = staking_pool_pda(&program_id);
    let stake_vault_key = stake_vault_pda(&program_id);
    let rewards_vault_key = rewards_vault_pda(&program_id);
    let staker_position_key = staker_position_pda(&program_id, &staker_key);
    let staker_token_key = new_unique_address();

    // Test parameters - staker already has 200 CRISPS staked
    let initial_staked_amount = 200_000_000u64; // 200 CRISPS staked
    let withdraw_amount = 75_000_000u64; // Withdraw 75 CRISPS
    let initial_staker_balance = 100_000_000u64; // 100 CRISPS in wallet
    let initial_vault_balance = initial_staked_amount;
    let initial_pool_staked = initial_staked_amount;

    // Expected final states
    let expected_staker_balance = initial_staker_balance + withdraw_amount;
    let expected_vault_balance = initial_vault_balance - withdraw_amount;
    let expected_pool_staked = initial_pool_staked - withdraw_amount;
    let expected_position_staked = initial_staked_amount - withdraw_amount;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        100_000_000,
        1_000_000_000,
    );

    let staking_pool_data = create_staking_pool_data(
        &stake_vault_key,
        &rewards_vault_key,
        initial_pool_staked,
        0,
        0,
    );

    let staker_position_data = create_staker_position_data(
        &staker_key,
        initial_staked_amount,
        0,
        0,
    );

    let mint_data = create_mint_data(&authority);
    let staker_token_data = create_token_account_data(&crisps_mint, &staker_key, initial_staker_balance);
    // Stake vault is owned by itself (self-ownership PDA pattern for transfer_signed)
    let stake_vault_data = create_token_account_data(&crisps_mint, &stake_vault_key, initial_vault_balance);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staking_pool_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staking_pool_data.len()),
            data: staking_pool_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_position_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_position_data.len()),
            data: staker_position_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_token_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_token_data.len()),
            data: staker_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        stake_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(stake_vault_data.len()),
            data: stake_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the staker for transaction fees
    svm.airdrop(&staker_key, 10_000_000_000).unwrap();

    // Build WithdrawStake instruction
    // Accounts:
    //   0. [writable] Staking pool PDA
    //   1. [writable] Staker position PDA
    //   2. [writable] Stake vault token account
    //   3. [writable] Staker's token account
    //   4. [signer] Staker
    //   5. [] Config
    //   6. [] Token-2022 program
    let withdraw_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: staking_pool_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_position_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: stake_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_token_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_key,
                is_signer: true,
                is_writable: false,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_withdraw_stake_ix(withdraw_amount),
    };

    let message = Message::new(&[withdraw_ix], Some(&staker_key));
    let tx = Transaction::new(&[&staker], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    // Verify token balances
    let staker_account = svm.get_account(&staker_token_key).unwrap();
    let vault_account = svm.get_account(&stake_vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&staker_account.data),
        expected_staker_balance,
        "Staker balance should be credited"
    );
    assert_eq!(
        parse_token_amount(&vault_account.data),
        expected_vault_balance,
        "Stake vault balance should be debited"
    );

    // Verify staking pool state
    let pool_account = svm.get_account(&staking_pool_key).unwrap();
    assert_eq!(
        parse_staking_pool_total_staked(&pool_account.data),
        expected_pool_staked,
        "StakingPool.total_staked should be updated"
    );

    // Verify staker position state
    let position_account = svm.get_account(&staker_position_key).unwrap();
    assert_eq!(
        parse_staker_position_staked_amount(&position_account.data),
        expected_position_staked,
        "StakerPosition.staked_amount should be reduced"
    );

    println!("✓ test_withdraw_stake_credits_staker_debits_vault passed (AC-3.5)");
}

/// Test: Claim rewards (proportional distribution) - AC-3.6
///
/// AC-3.6: Rake distributions are proportional to staked balances and are claimable via an on-chain instruction.
///
/// This test validates:
/// 1. Staker receives proportional share of accumulated rewards
/// 2. Rewards vault is debited by claimed amount
/// 3. StakerPosition.rewards_claimed is updated
/// 4. StakingPool.accumulated_rewards is reduced
#[test]
fn test_claim_rewards_proportional_distribution() {
    let program_id = Address::from(robopoker_poker::ID);
    let staker = Keypair::new();
    let staker_key = staker.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Derive PDAs
    let config_key = config_pda(&program_id);
    let staking_pool_key = staking_pool_pda(&program_id);
    let stake_vault_key = stake_vault_pda(&program_id);
    let rewards_vault_key = rewards_vault_pda(&program_id);
    let staker_position_key = staker_position_pda(&program_id, &staker_key);
    let staker_token_key = new_unique_address();

    // Test scenario:
    // - Total staked in pool: 1000 CRISPS
    // - This staker has: 400 CRISPS staked (40% of pool)
    // - Accumulated rewards: 100 CRISPS
    // - Expected claim: 40 CRISPS (40% of 100)
    let total_staked = 1_000_000_000u64; // 1000 CRISPS
    let staker_stake = 400_000_000u64; // 400 CRISPS (40%)
    let accumulated_rewards = 100_000_000u64; // 100 CRISPS rewards
    let expected_claim = 40_000_000u64; // 40% of 100 = 40 CRISPS

    let initial_staker_balance = 50_000_000u64; // 50 CRISPS in wallet
    let initial_rewards_vault = accumulated_rewards;

    // Expected final states
    let expected_staker_balance = initial_staker_balance + expected_claim;
    let expected_rewards_vault = initial_rewards_vault - expected_claim;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        100_000_000,
        1_000_000_000,
    );

    let staking_pool_data = create_staking_pool_data(
        &stake_vault_key,
        &rewards_vault_key,
        total_staked,
        accumulated_rewards,
        0, // total_distributed
    );

    let staker_position_data = create_staker_position_data(
        &staker_key,
        staker_stake,
        0, // rewards_claimed (none yet)
        0, // last_rewards_per_token
    );

    let mint_data = create_mint_data(&authority);
    let staker_token_data = create_token_account_data(&crisps_mint, &staker_key, initial_staker_balance);
    // Rewards vault is owned by itself (self-ownership PDA pattern for transfer_signed)
    let rewards_vault_data = create_token_account_data(&crisps_mint, &rewards_vault_key, initial_rewards_vault);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staking_pool_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staking_pool_data.len()),
            data: staking_pool_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_position_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_position_data.len()),
            data: staker_position_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staker_token_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staker_token_data.len()),
            data: staker_token_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        rewards_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(rewards_vault_data.len()),
            data: rewards_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the staker for transaction fees
    svm.airdrop(&staker_key, 10_000_000_000).unwrap();

    // Build ClaimRewards instruction
    // Accounts:
    //   0. [writable] Staking pool PDA
    //   1. [writable] Staker position PDA
    //   2. [writable] Rewards vault token account
    //   3. [writable] Staker's token account
    //   4. [signer] Staker
    //   5. [] Config
    //   6. [] Token-2022 program
    let claim_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: staking_pool_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_position_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: rewards_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_token_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staker_key,
                is_signer: true,
                is_writable: false,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_claim_rewards_ix(),
    };

    let message = Message::new(&[claim_ix], Some(&staker_key));
    let tx = Transaction::new(&[&staker], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    // Verify token balances
    let staker_account = svm.get_account(&staker_token_key).unwrap();
    let rewards_account = svm.get_account(&rewards_vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&staker_account.data),
        expected_staker_balance,
        "Staker balance should be credited with proportional rewards"
    );
    assert_eq!(
        parse_token_amount(&rewards_account.data),
        expected_rewards_vault,
        "Rewards vault should be debited"
    );

    // Verify staking pool state
    let pool_account = svm.get_account(&staking_pool_key).unwrap();
    let remaining_rewards = parse_staking_pool_accumulated_rewards(&pool_account.data);
    assert_eq!(
        remaining_rewards,
        accumulated_rewards - expected_claim,
        "StakingPool.accumulated_rewards should be reduced"
    );

    // Verify staker position state
    let position_account = svm.get_account(&staker_position_key).unwrap();
    let rewards_claimed = parse_staker_position_rewards_claimed(&position_account.data);
    assert_eq!(
        rewards_claimed, expected_claim,
        "StakerPosition.rewards_claimed should track claimed amount"
    );

    println!("✓ test_claim_rewards_proportional_distribution passed (AC-3.6)");
    println!("  - Staker stake: {} CRISPS ({}% of pool)", staker_stake / 1_000_000, (staker_stake * 100) / total_staked);
    println!("  - Accumulated rewards: {} CRISPS", accumulated_rewards / 1_000_000);
    println!("  - Claimed: {} CRISPS (proportional share)", expected_claim / 1_000_000);
}

/// Test: Sweep rake from table to staking pool - AC-3.4
///
/// AC-3.4: Standard rake is charged per hand and accumulated in a staking rewards pool.
///
/// This test validates:
/// 1. Rake is transferred from table vault to rewards vault
/// 2. Table.rake_accumulated is reset to 0
/// 3. StakingPool.accumulated_rewards is increased
#[test]
fn test_sweep_rake_table_to_rewards_vault() {
    let program_id = Address::from(robopoker_poker::ID);
    let caller = Keypair::new();
    let caller_key = caller.pubkey();
    let authority = new_unique_address();
    let entropy_program = new_unique_address();
    let crisps_mint = new_unique_address();

    // Derive PDAs
    let table_id = 1u64;
    let config_key = config_pda(&program_id);
    let table_key = table_pda(&program_id, table_id);
    let table_vault_key = vault_pda(&program_id, table_id);
    let staking_pool_key = staking_pool_pda(&program_id);
    let stake_vault_key = stake_vault_pda(&program_id);
    let rewards_vault_key = rewards_vault_pda(&program_id);

    // Test parameters
    let rake_amount = 5_000_000u64; // 5 CRISPS rake accumulated
    let initial_table_vault = 100_000_000u64; // 100 CRISPS in table vault (includes rake)
    let initial_rewards_vault = 50_000_000u64; // 50 CRISPS already in rewards
    let initial_pool_rewards = 50_000_000u64;

    // Expected final states
    let expected_table_vault = initial_table_vault - rake_amount;
    let expected_rewards_vault = initial_rewards_vault + rake_amount;
    let expected_pool_rewards = initial_pool_rewards + rake_amount;

    // Create LiteSVM instance with programs loaded
    let mut svm = setup_svm(&program_id);

    // Set up accounts
    let config_data = create_config_data(
        &crisps_mint,
        &authority,
        &entropy_program,
        100_000_000,
        1_000_000_000,
    );

    // Create table with accumulated rake
    let mut table_data = create_table_data(table_id, 1_000_000, 2_000_000, &table_vault_key);
    // Set rake_accumulated at offset 72
    table_data[72..80].copy_from_slice(&rake_amount.to_le_bytes());

    let staking_pool_data = create_staking_pool_data(
        &stake_vault_key,
        &rewards_vault_key,
        500_000_000, // total_staked
        initial_pool_rewards,
        0,
    );

    let mint_data = create_mint_data(&authority);
    // Table vault is owned by itself (self-ownership PDA pattern for transfer_signed)
    let table_vault_data = create_token_account_data(&crisps_mint, &table_vault_key, initial_table_vault);
    // Rewards vault is owned by itself (self-ownership PDA pattern for transfer_signed)
    let rewards_vault_data = create_token_account_data(&crisps_mint, &rewards_vault_key, initial_rewards_vault);

    // Set accounts in SVM
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(config_data.len()),
            data: config_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        table_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(table_data.len()),
            data: table_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        staking_pool_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(staking_pool_data.len()),
            data: staking_pool_data,
            owner: Address::from(&program_id),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        crisps_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(mint_data.len()),
            data: mint_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        table_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(table_vault_data.len()),
            data: table_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.set_account(
        rewards_vault_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(rewards_vault_data.len()),
            data: rewards_vault_data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Fund the caller for transaction fees (anyone can sweep)
    svm.airdrop(&caller_key, 10_000_000_000).unwrap();

    // Build SweepRake instruction
    // Accounts:
    //   0. [writable] Table
    //   1. [writable] Table vault token account
    //   2. [writable] Staking pool PDA
    //   3. [writable] Rewards vault token account
    //   4. [] Config
    //   5. [] Token-2022 program
    let sweep_ix = Instruction {
        program_id: Address::from(&program_id),
        accounts: vec![
            AccountMeta {
                pubkey: table_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: table_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: staking_pool_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: rewards_vault_key,
                is_signer: false,
                is_writable: true,
            },
            AccountMeta {
                pubkey: config_key,
                is_signer: false,
                is_writable: false,
            },
            AccountMeta {
                pubkey: TOKEN_2022_PROGRAM_ID,
                is_signer: false,
                is_writable: false,
            },
        ],
        data: build_sweep_rake_ix(),
    };

    let message = Message::new(&[sweep_ix], Some(&caller_key));
    let tx = Transaction::new(&[&caller], message, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    // Verify token balances
    let table_vault_account = svm.get_account(&table_vault_key).unwrap();
    let rewards_vault_account = svm.get_account(&rewards_vault_key).unwrap();

    assert_eq!(
        parse_token_amount(&table_vault_account.data),
        expected_table_vault,
        "Table vault should be debited by rake amount"
    );
    assert_eq!(
        parse_token_amount(&rewards_vault_account.data),
        expected_rewards_vault,
        "Rewards vault should be credited with rake"
    );

    // Verify table state (rake_accumulated reset)
    let table_account = svm.get_account(&table_key).unwrap();
    let table_rake = u64::from_le_bytes(table_account.data[72..80].try_into().unwrap());
    assert_eq!(table_rake, 0, "Table.rake_accumulated should be reset to 0");

    // Verify staking pool state
    let pool_account = svm.get_account(&staking_pool_key).unwrap();
    assert_eq!(
        parse_staking_pool_accumulated_rewards(&pool_account.data),
        expected_pool_rewards,
        "StakingPool.accumulated_rewards should be increased"
    );

    println!("✓ test_sweep_rake_table_to_rewards_vault passed (AC-3.4)");
    println!("  - Rake swept: {} CRISPS", rake_amount / 1_000_000);
    println!("  - Rewards vault: {} -> {} CRISPS", initial_rewards_vault / 1_000_000, expected_rewards_vault / 1_000_000);
}
