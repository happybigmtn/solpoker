//! Mollusk tests for poker <-> entropy CPI integration.

use mollusk_svm::{
    file,
    program::{create_program_account_pair_loader_v3, keyed_account_for_system_program, loader_keys},
    Mollusk,
};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use std::{path::PathBuf, sync::Once};

use robopoker_core::cards::Deck;
use robopoker_entropy;
use robopoker_poker::{
    entropy::{
        commitment_status as entropy_commitment_status,
        discriminator as entropy_disc,
        EntropyRequest,
        CONFIG_SIZE as ENTROPY_CONFIG_SIZE,
        COMMITMENT_SIZE as ENTROPY_COMMITMENT_SIZE,
        REQUEST_SIZE as ENTROPY_REQUEST_SIZE,
    },
    error::PokerError,
    instruction::discriminator as ix_disc,
    state::{
        discriminator as acc_disc, seat_status, table_status, Config, Seat, Table, CONFIG_SIZE,
        MAX_SEATS, TABLE_SIZE,
    },
};

/// System program ID
const SYSTEM_PROGRAM_ID: Address = solana_address::address!("11111111111111111111111111111111");

const SEAT_SIZE: usize = core::mem::size_of::<Seat>();
const TABLE_HEADER_SIZE: usize = TABLE_SIZE - (MAX_SEATS * SEAT_SIZE);

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn new_unique_address() -> Address {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&n.to_le_bytes());
    bytes[31] = 0;
    Address::from(bytes)
}

fn program_accounts(program_id: &Address, program_name: &str) -> Vec<(Address, Account)> {
    ensure_sbf_out_dir();
    let elf = file::load_program_elf(program_name);
    let (program_account, programdata_account) =
        create_program_account_pair_loader_v3(program_id, &elf);
    let programdata_address =
        Address::find_program_address(&[program_id.as_ref()], &loader_keys::LOADER_V3).0;
    vec![(*program_id, program_account), (programdata_address, programdata_account)]
}

fn new_mollusk() -> Mollusk {
    ensure_sbf_out_dir();
    Mollusk::default()
}

fn ensure_sbf_out_dir() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        if std::env::var("SBF_OUT_DIR").is_ok() {
            return;
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let out_dir = manifest_dir.join("..").join("..").join("target").join("deploy");
        if out_dir.is_dir() {
            std::env::set_var("SBF_OUT_DIR", out_dir);
        }
    });
}

fn derive_poker_config_pda(program_id: &Address) -> Address {
    Address::find_program_address(Config::SEEDS, program_id).0
}

fn derive_table_pda(program_id: &Address, table_id: u64) -> Address {
    let table_id_bytes = table_id.to_le_bytes();
    Address::find_program_address(&[Table::SEEDS_PREFIX, &table_id_bytes], program_id).0
}

fn derive_entropy_config_pda(entropy_program_id: &Address) -> Address {
    Address::find_program_address(&[b"config"], entropy_program_id).0
}

fn derive_entropy_commitment_pda(
    entropy_program_id: &Address,
    provider: &Address,
    sequence: u64,
) -> Address {
    let sequence_bytes = sequence.to_le_bytes();
    Address::find_program_address(&[b"commitment", provider.as_ref(), &sequence_bytes], entropy_program_id).0
}

fn derive_entropy_request_pda(
    entropy_program_id: &Address,
    table_key: &Address,
    request_id: u64,
) -> Address {
    let request_id_bytes = request_id.to_le_bytes();
    Address::find_program_address(&[b"request", table_key.as_ref(), &request_id_bytes], entropy_program_id).0
}

fn create_poker_config_data(
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
    data[1] = 1;
    data[2] = min_players;
    data[6..8].copy_from_slice(&250u16.to_le_bytes()); // rake_bps
    data[8..40].copy_from_slice(crisps_mint.as_ref());
    data[40..72].copy_from_slice(authority.as_ref());
    data[72..104].copy_from_slice(entropy_program.as_ref());
    data[104..112].copy_from_slice(&min_buy_in.to_le_bytes());
    data[112..120].copy_from_slice(&max_buy_in.to_le_bytes());
    data[120..128].copy_from_slice(&action_timeout_slots.to_le_bytes());
    data
}

fn create_table_data_with_players(
    table_id: u64,
    hand_id: u64,
    small_blind: u64,
    big_blind: u64,
    vault: &Address,
    players: &[(&Address, u64, usize)],
) -> Vec<u8> {
    let mut data = vec![0u8; TABLE_SIZE];
    data[0] = acc_disc::TABLE;
    data[1] = table_status::WAITING;
    data[2] = players.len() as u8;
    // Compute active_bitmap from seat indices
    let mut active_bitmap: u16 = 0;
    for (_, _, seat_index) in players {
        active_bitmap |= 1 << seat_index;
    }
    data[8..10].copy_from_slice(&active_bitmap.to_le_bytes());
    data[16..24].copy_from_slice(&table_id.to_le_bytes());
    data[24..32].copy_from_slice(&hand_id.to_le_bytes());
    data[32..40].copy_from_slice(&small_blind.to_le_bytes());
    data[40..48].copy_from_slice(&big_blind.to_le_bytes());
    data[64..72].copy_from_slice(&big_blind.to_le_bytes()); // min_raise = big_blind
    data[88..120].copy_from_slice(vault.as_ref());

    for (player, stack, seat_index) in players {
        let seat_offset = TABLE_HEADER_SIZE + seat_index * SEAT_SIZE;
        data[seat_offset] = seat_status::OCCUPIED;
        data[seat_offset + 1] = 0;
        data[seat_offset + 8..seat_offset + 40].copy_from_slice(player.as_ref());
        data[seat_offset + 40..seat_offset + 48].copy_from_slice(&stack.to_le_bytes());
    }

    data
}

fn create_entropy_config_data(
    provider: &Address,
    authority: &Address,
    min_bond: u64,
    reveal_window: u64,
    slash_bp: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; ENTROPY_CONFIG_SIZE];
    data[0] = entropy_disc::CONFIG;
    data[1] = 1;
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(authority.as_ref());
    data[72..80].copy_from_slice(&min_bond.to_le_bytes());
    data[80..88].copy_from_slice(&reveal_window.to_le_bytes());
    data[88..96].copy_from_slice(&slash_bp.to_le_bytes());
    data
}

fn create_entropy_commitment_data(
    provider: &Address,
    hash: [u8; 32],
    bond_amount: u64,
    commit_slot: u64,
    sequence: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; ENTROPY_COMMITMENT_SIZE];
    data[0] = entropy_disc::COMMITMENT;
    data[1] = entropy_commitment_status::PENDING;
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(&hash);
    data[72..80].copy_from_slice(&bond_amount.to_le_bytes());
    data[80..88].copy_from_slice(&commit_slot.to_le_bytes());
    data[88..96].copy_from_slice(&sequence.to_le_bytes());
    data
}

fn build_start_hand_ix(seed_commitment: [u8; 32], hole_card_hashes: [[u8; 32]; MAX_SEATS]) -> Vec<u8> {
    let mut data = vec![ix_disc::START_HAND, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&seed_commitment);
    for hash in hole_card_hashes {
        data.extend_from_slice(&hash);
    }
    data
}

fn build_reveal_seed_ix(seed: [u8; 32], revealed_hole_cards: [[u8; 2]; MAX_SEATS]) -> Vec<u8> {
    let mut data = vec![ix_disc::REVEAL_SEED, 0, 0, 0, 0, 0, 0, 0];
    data.extend_from_slice(&seed);
    for cards in revealed_hole_cards {
        data.extend_from_slice(&cards);
    }
    data
}

fn deal_seat_order(table: &Table) -> ([usize; MAX_SEATS], usize) {
    let mut order = [0usize; MAX_SEATS];
    let mut count = 0usize;
    let mut pos = (table.dealer_position as usize + 1) % MAX_SEATS;
    for _ in 0..MAX_SEATS {
        if table.seats[pos].is_active() {
            order[count] = pos;
            count = count.saturating_add(1);
        }
        pos = (pos + 1) % MAX_SEATS;
    }
    (order, count)
}

fn derive_hole_cards(table: &Table, seed: &[u8; 32]) -> [[u8; 2]; MAX_SEATS] {
    let mut deck = Deck::new();
    deck.shuffle_with_seed(seed);

    let (order, count) = deal_seat_order(table);
    let mut hole_cards = [[0u8; 2]; MAX_SEATS];
    for round in 0..2 {
        for i in 0..count {
            let seat_idx = order[i];
            let card = deck.draw();
            hole_cards[seat_idx][round] = u8::from(card);
        }
    }
    hole_cards
}

fn apply_hole_card_hashes(data: &mut [u8], hashes: &[[u8; 32]; MAX_SEATS]) {
    for i in 0..MAX_SEATS {
        let seat_offset = TABLE_HEADER_SIZE + i * SEAT_SIZE;
        let hash_offset = seat_offset + 64;
        data[hash_offset..hash_offset + 32].copy_from_slice(&hashes[i]);
    }
}

fn create_showdown_table_data(
    table_id: u64,
    hand_id: u64,
    small_blind: u64,
    big_blind: u64,
    vault: &Address,
    seed_commitment: [u8; 32],
    players: &[(&Address, u64, usize)],
) -> Vec<u8> {
    let mut data = create_table_data_with_players(table_id, hand_id, small_blind, big_blind, vault, players);
    data[1] = table_status::SHOWDOWN;
    data[6] = 0; // seed_revealed = false
    data[120..152].copy_from_slice(&seed_commitment);
    data
}

fn create_entropy_request_data(
    requester: &Address,
    commitment: &Address,
    request_id: u64,
    request_slot: u64,
    deadline_slot: u64,
    slothash: [u8; 32],
) -> Vec<u8> {
    let mut data = vec![0u8; ENTROPY_REQUEST_SIZE];
    data[0] = entropy_disc::REQUEST;
    data[1] = 0;
    data[8..40].copy_from_slice(requester.as_ref());
    data[40..72].copy_from_slice(commitment.as_ref());
    data[72..80].copy_from_slice(&request_id.to_le_bytes());
    data[80..88].copy_from_slice(&request_slot.to_le_bytes());
    data[88..96].copy_from_slice(&deadline_slot.to_le_bytes());
    data[128..160].copy_from_slice(&slothash);
    data
}

fn create_entropy_commitment_revealed_data(
    provider: &Address,
    hash: [u8; 32],
    preimage: [u8; 32],
    bond_amount: u64,
    commit_slot: u64,
    sequence: u64,
) -> Vec<u8> {
    let mut data = vec![0u8; ENTROPY_COMMITMENT_SIZE];
    data[0] = entropy_disc::COMMITMENT;
    data[1] = entropy_commitment_status::REVEALED;
    data[8..40].copy_from_slice(provider.as_ref());
    data[40..72].copy_from_slice(&hash);
    data[72..80].copy_from_slice(&bond_amount.to_le_bytes());
    data[80..88].copy_from_slice(&commit_slot.to_le_bytes());
    data[88..96].copy_from_slice(&sequence.to_le_bytes());
    data[96..128].copy_from_slice(&preimage);
    data
}

#[test]
fn test_start_hand_requests_entropy_via_cpi() {
    let poker_program_id = Address::from(robopoker_poker::ID);
    let entropy_program_id = Address::from(robopoker_entropy::ID);

    let provider = new_unique_address();
    let authority = new_unique_address();
    let crisps_mint = new_unique_address();
    let vault = new_unique_address();
    let player_a = new_unique_address();
    let player_b = new_unique_address();

    let table_id = 1u64;
    let hand_id = 1u64;
    let sequence = 1u64;
    let seed_commitment = [0x11; 32];
    let mut hole_card_hashes = [[0u8; 32]; MAX_SEATS];
    hole_card_hashes[0] = [0x01; 32];
    hole_card_hashes[1] = [0x02; 32];

    let config_key = derive_poker_config_pda(&poker_program_id);
    let table_key = derive_table_pda(&poker_program_id, table_id);

    let entropy_config_key = derive_entropy_config_pda(&entropy_program_id);
    let entropy_commitment_key =
        derive_entropy_commitment_pda(&entropy_program_id, &provider, sequence);
    let entropy_request_key =
        derive_entropy_request_pda(&entropy_program_id, &table_key, hand_id);

    let config_data = create_poker_config_data(
        &crisps_mint,
        &authority,
        &entropy_program_id,
        1_000,
        10_000,
        2,
        100,
    );
    let table_data = create_table_data_with_players(
        table_id,
        hand_id,
        1_000,
        2_000,
        &vault,
        &[(&player_a, 10_000, 0), (&player_b, 10_000, 1)],
    );
    let entropy_config_data = create_entropy_config_data(&provider, &authority, 1, 100, 5000);
    let entropy_commitment_data =
        create_entropy_commitment_data(&provider, seed_commitment, 1_000, 0, sequence);

    let mut mollusk = new_mollusk();
    mollusk.add_program(&poker_program_id, "robopoker_poker");
    mollusk.add_program(&entropy_program_id, "robopoker_entropy");

    let (clock_key, clock_account) = mollusk.sysvars.keyed_account_for_clock_sysvar();
    let (slot_hashes_key, slot_hashes_account) =
        mollusk.sysvars.keyed_account_for_slot_hashes_sysvar();
    let (system_program_key, system_program_account) = keyed_account_for_system_program();

    let start_ix = Instruction {
        program_id: poker_program_id,
        accounts: vec![
            AccountMeta { pubkey: table_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: clock_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_program_id, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_commitment_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_request_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: slot_hashes_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: system_program_key, is_signer: false, is_writable: false },
        ],
        data: build_start_hand_ix(seed_commitment, hole_card_hashes),
    };

    let mut accounts = Vec::new();
    accounts.extend(program_accounts(&poker_program_id, "robopoker_poker"));
    accounts.extend(program_accounts(&entropy_program_id, "robopoker_entropy"));
    accounts.push((table_key, Account {
        lamports: 1_000_000,
        data: table_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((provider, Account {
        lamports: 10_000_000_000,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((config_key, Account {
        lamports: 1_000_000,
        data: config_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((clock_key, clock_account));
    accounts.push((entropy_config_key, Account {
        lamports: 1_000_000,
        data: entropy_config_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_commitment_key, Account {
        lamports: 1_000_000,
        data: entropy_commitment_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_request_key, Account {
        lamports: 0,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((slot_hashes_key, slot_hashes_account));
    accounts.push((system_program_key, system_program_account));

    let result = mollusk.process_instruction(&start_ix, &accounts);
    assert!(result.program_result.is_ok(), "Start hand should succeed: {:?}", result.program_result);

    let request_account = result.get_account(&entropy_request_key).unwrap();
    assert_eq!(request_account.owner, entropy_program_id);
    assert_eq!(request_account.data.len(), ENTROPY_REQUEST_SIZE);
    let request = EntropyRequest::from_bytes(&request_account.data).unwrap();
    let commitment_bytes: [u8; 32] = entropy_commitment_key.as_ref().try_into().unwrap();
    let table_bytes: [u8; 32] = table_key.as_ref().try_into().unwrap();
    assert!(request.is_pending());
    assert_eq!(request.request_id, hand_id);
    assert_eq!(request.commitment, commitment_bytes);
    assert_eq!(request.requester, table_bytes);

    let table_account = result.get_account(&table_key).unwrap();
    let table = Table::from_bytes(&table_account.data).unwrap();
    assert_eq!(table.status, table_status::PLAYING);
    assert_eq!(table.seed_commitment, seed_commitment);
}

#[test]
fn test_start_hand_rejects_provider_mismatch() {
    let poker_program_id = Address::from(robopoker_poker::ID);
    let entropy_program_id = Address::from(robopoker_entropy::ID);

    let provider = new_unique_address();
    let imposter = new_unique_address();
    let authority = new_unique_address();
    let crisps_mint = new_unique_address();
    let vault = new_unique_address();
    let player_a = new_unique_address();
    let player_b = new_unique_address();

    let table_id = 2u64;
    let hand_id = 1u64;
    let sequence = 1u64;
    let seed_commitment = [0x22; 32];
    let hole_card_hashes = [[0u8; 32]; MAX_SEATS];

    let config_key = derive_poker_config_pda(&poker_program_id);
    let table_key = derive_table_pda(&poker_program_id, table_id);

    let entropy_config_key = derive_entropy_config_pda(&entropy_program_id);
    let entropy_commitment_key =
        derive_entropy_commitment_pda(&entropy_program_id, &provider, sequence);
    let entropy_request_key =
        derive_entropy_request_pda(&entropy_program_id, &table_key, hand_id);

    let config_data = create_poker_config_data(
        &crisps_mint,
        &authority,
        &entropy_program_id,
        1_000,
        10_000,
        2,
        100,
    );
    let table_data = create_table_data_with_players(
        table_id,
        hand_id,
        1_000,
        2_000,
        &vault,
        &[(&player_a, 10_000, 0), (&player_b, 10_000, 1)],
    );
    let entropy_config_data = create_entropy_config_data(&provider, &authority, 1, 100, 5000);
    let entropy_commitment_data =
        create_entropy_commitment_data(&provider, seed_commitment, 1_000, 0, sequence);

    let mut mollusk = new_mollusk();
    mollusk.add_program(&poker_program_id, "robopoker_poker");
    mollusk.add_program(&entropy_program_id, "robopoker_entropy");

    let (clock_key, clock_account) = mollusk.sysvars.keyed_account_for_clock_sysvar();
    let (slot_hashes_key, slot_hashes_account) =
        mollusk.sysvars.keyed_account_for_slot_hashes_sysvar();
    let (system_program_key, system_program_account) = keyed_account_for_system_program();

    let start_ix = Instruction {
        program_id: poker_program_id,
        accounts: vec![
            AccountMeta { pubkey: table_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: imposter, is_signer: true, is_writable: true },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: clock_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_program_id, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_commitment_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_request_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: slot_hashes_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: system_program_key, is_signer: false, is_writable: false },
        ],
        data: build_start_hand_ix(seed_commitment, hole_card_hashes),
    };

    let mut accounts = Vec::new();
    accounts.extend(program_accounts(&poker_program_id, "robopoker_poker"));
    accounts.extend(program_accounts(&entropy_program_id, "robopoker_entropy"));
    accounts.push((table_key, Account {
        lamports: 1_000_000,
        data: table_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((imposter, Account {
        lamports: 10_000_000_000,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((config_key, Account {
        lamports: 1_000_000,
        data: config_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((clock_key, clock_account));
    accounts.push((entropy_config_key, Account {
        lamports: 1_000_000,
        data: entropy_config_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_commitment_key, Account {
        lamports: 1_000_000,
        data: entropy_commitment_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_request_key, Account {
        lamports: 0,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((slot_hashes_key, slot_hashes_account));
    accounts.push((system_program_key, system_program_account));

    let result = mollusk.process_instruction(&start_ix, &accounts);
    assert!(matches!(
        result.raw_result,
        Err(InstructionError::Custom(code)) if code == PokerError::ProviderMismatch as u32
    ));
}

#[test]
fn test_reveal_seed_verifies_hole_cards() {
    let poker_program_id = Address::from(robopoker_poker::ID);
    let entropy_program_id = Address::from(robopoker_entropy::ID);

    let provider = new_unique_address();
    let authority = new_unique_address();
    let crisps_mint = new_unique_address();
    let vault = new_unique_address();
    let player_a = new_unique_address();
    let player_b = new_unique_address();

    let table_id = 3u64;
    let hand_id = 7u64;
    let sequence = 1u64;
    let seed = [0x33; 32];
    let seed_commitment = sha256(&seed);

    let config_key = derive_poker_config_pda(&poker_program_id);
    let table_key = derive_table_pda(&poker_program_id, table_id);

    let entropy_config_key = derive_entropy_config_pda(&entropy_program_id);
    let entropy_commitment_key =
        derive_entropy_commitment_pda(&entropy_program_id, &provider, sequence);
    let entropy_request_key =
        derive_entropy_request_pda(&entropy_program_id, &table_key, hand_id);

    let config_data = create_poker_config_data(
        &crisps_mint,
        &authority,
        &entropy_program_id,
        1_000,
        10_000,
        2,
        100,
    );
    let mut table_data = create_showdown_table_data(
        table_id,
        hand_id,
        1_000,
        2_000,
        &vault,
        seed_commitment,
        &[(&player_a, 10_000, 0), (&player_b, 10_000, 1)],
    );
    let table_view = Table::from_bytes(&table_data).unwrap();
    let derived_hole_cards = derive_hole_cards(table_view, &seed);
    let mut hole_hashes = [[0u8; 32]; MAX_SEATS];
    for i in 0..MAX_SEATS {
        let seat = &table_view.seats[i];
        if seat.is_empty() || seat.status == seat_status::SITTING_OUT {
            continue;
        }
        hole_hashes[i] = sha256(&derived_hole_cards[i]);
    }
    apply_hole_card_hashes(&mut table_data, &hole_hashes);

    let entropy_config_data = create_entropy_config_data(&provider, &authority, 1, 100, 5000);
    let entropy_commitment_data = create_entropy_commitment_revealed_data(
        &provider,
        seed_commitment,
        seed,
        1_000,
        0,
        sequence,
    );
    let entropy_request_data = create_entropy_request_data(
        &table_key,
        &entropy_commitment_key,
        hand_id,
        0,
        0,
        [0xAA; 32],
    );

    let mut mollusk = new_mollusk();
    mollusk.add_program(&poker_program_id, "robopoker_poker");
    mollusk.add_program(&entropy_program_id, "robopoker_entropy");

    let reveal_ix = Instruction {
        program_id: poker_program_id,
        accounts: vec![
            AccountMeta { pubkey: table_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: false },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_program_id, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_commitment_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_request_key, is_signer: false, is_writable: true },
        ],
        data: build_reveal_seed_ix(seed, derived_hole_cards),
    };

    let mut accounts = Vec::new();
    accounts.extend(program_accounts(&poker_program_id, "robopoker_poker"));
    accounts.extend(program_accounts(&entropy_program_id, "robopoker_entropy"));
    accounts.push((table_key, Account {
        lamports: 1_000_000,
        data: table_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((provider, Account {
        lamports: 1_000_000,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((config_key, Account {
        lamports: 1_000_000,
        data: config_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_config_key, Account {
        lamports: 1_000_000,
        data: entropy_config_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_commitment_key, Account {
        lamports: 1_000_000,
        data: entropy_commitment_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_request_key, Account {
        lamports: 1_000_000,
        data: entropy_request_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));

    let result = mollusk.process_instruction(&reveal_ix, &accounts);
    assert!(result.program_result.is_ok(), "Reveal seed should succeed: {:?}", result.program_result);

    let table_account = result.get_account(&table_key).unwrap();
    let table = Table::from_bytes(&table_account.data).unwrap();
    assert_eq!(table.seed_revealed, 1);
    assert_eq!(table.revealed_seed, seed);

    let request_account = result.get_account(&entropy_request_key).unwrap();
    let request = EntropyRequest::from_bytes(&request_account.data).unwrap();
    assert!(request.is_finalized());
}

#[test]
fn test_reveal_seed_rejects_mismatched_hole_cards() {
    let poker_program_id = Address::from(robopoker_poker::ID);
    let entropy_program_id = Address::from(robopoker_entropy::ID);

    let provider = new_unique_address();
    let authority = new_unique_address();
    let crisps_mint = new_unique_address();
    let vault = new_unique_address();
    let player_a = new_unique_address();
    let player_b = new_unique_address();

    let table_id = 4u64;
    let hand_id = 9u64;
    let sequence = 2u64;
    let seed = [0x44; 32];
    let seed_commitment = sha256(&seed);

    let config_key = derive_poker_config_pda(&poker_program_id);
    let table_key = derive_table_pda(&poker_program_id, table_id);

    let entropy_config_key = derive_entropy_config_pda(&entropy_program_id);
    let entropy_commitment_key =
        derive_entropy_commitment_pda(&entropy_program_id, &provider, sequence);
    let entropy_request_key =
        derive_entropy_request_pda(&entropy_program_id, &table_key, hand_id);

    let config_data = create_poker_config_data(
        &crisps_mint,
        &authority,
        &entropy_program_id,
        1_000,
        10_000,
        2,
        100,
    );
    let mut table_data = create_showdown_table_data(
        table_id,
        hand_id,
        1_000,
        2_000,
        &vault,
        seed_commitment,
        &[(&player_a, 10_000, 0), (&player_b, 10_000, 1)],
    );
    let table_view = Table::from_bytes(&table_data).unwrap();
    let derived_hole_cards = derive_hole_cards(table_view, &seed);
    let mut hole_hashes = [[0u8; 32]; MAX_SEATS];
    for i in 0..MAX_SEATS {
        let seat = &table_view.seats[i];
        if seat.is_empty() || seat.status == seat_status::SITTING_OUT {
            continue;
        }
        hole_hashes[i] = sha256(&derived_hole_cards[i]);
    }
    apply_hole_card_hashes(&mut table_data, &hole_hashes);

    let entropy_config_data = create_entropy_config_data(&provider, &authority, 1, 100, 5000);
    let entropy_commitment_data = create_entropy_commitment_revealed_data(
        &provider,
        seed_commitment,
        seed,
        1_000,
        0,
        sequence,
    );
    let entropy_request_data = create_entropy_request_data(
        &table_key,
        &entropy_commitment_key,
        hand_id,
        0,
        0,
        [0xAA; 32],
    );

    let mut mollusk = new_mollusk();
    mollusk.add_program(&poker_program_id, "robopoker_poker");
    mollusk.add_program(&entropy_program_id, "robopoker_entropy");

    let mut revealed_hole_cards = derived_hole_cards;
    revealed_hole_cards[0][0] = revealed_hole_cards[0][0].wrapping_add(1);

    let reveal_ix = Instruction {
        program_id: poker_program_id,
        accounts: vec![
            AccountMeta { pubkey: table_key, is_signer: false, is_writable: true },
            AccountMeta { pubkey: provider, is_signer: true, is_writable: false },
            AccountMeta { pubkey: config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_program_id, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_config_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_commitment_key, is_signer: false, is_writable: false },
            AccountMeta { pubkey: entropy_request_key, is_signer: false, is_writable: true },
        ],
        data: build_reveal_seed_ix(seed, revealed_hole_cards),
    };

    let mut accounts = Vec::new();
    accounts.extend(program_accounts(&poker_program_id, "robopoker_poker"));
    accounts.extend(program_accounts(&entropy_program_id, "robopoker_entropy"));
    accounts.push((table_key, Account {
        lamports: 1_000_000,
        data: table_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((provider, Account {
        lamports: 1_000_000,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((config_key, Account {
        lamports: 1_000_000,
        data: config_data,
        owner: poker_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_config_key, Account {
        lamports: 1_000_000,
        data: entropy_config_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_commitment_key, Account {
        lamports: 1_000_000,
        data: entropy_commitment_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));
    accounts.push((entropy_request_key, Account {
        lamports: 1_000_000,
        data: entropy_request_data,
        owner: entropy_program_id,
        executable: false,
        rent_epoch: 0,
    }));

    let result = mollusk.process_instruction(&reveal_ix, &accounts);
    assert!(matches!(
        result.raw_result,
        Err(InstructionError::Custom(code)) if code == PokerError::HoleCardHashMismatch as u32
    ));
}
