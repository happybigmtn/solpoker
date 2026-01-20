# Account Layout Versioning (AC-PR1.8)

This document describes the versioning strategy for on-chain account layouts and migration procedures.

## Version Tracking

Account versions are embedded in the discriminator byte:
- **Bits 0-3**: Account type (Config=1, Table=2, etc.)
- **Bits 4-7**: Layout version (0-15)

Current versions:

| Account          | Discriminator | Type Bits | Version Bits | Layout Version |
|------------------|---------------|-----------|--------------|----------------|
| Entropy Config   | 0x01          | 1         | 0            | v0 (initial)   |
| Entropy Commit   | 0x02          | 2         | 0            | v0 (initial)   |
| Entropy Request  | 0x03          | 3         | 0            | v0 (initial)   |
| Poker Config     | 0x01          | 1         | 0            | v0 (initial)   |
| Poker Table      | 0x02          | 2         | 0            | v0 (initial)   |
| Staking Pool     | 0x03          | 3         | 0            | v0 (initial)   |
| Staker Position  | 0x04          | 4         | 0            | v0 (initial)   |

## Account Size Constraints

Fixed sizes are enforced via compile-time assertions:

```rust
// From crates/robopoker-entropy/src/state.rs
const_assert_eq!(CONFIG_SIZE, 96);
const_assert_eq!(COMMITMENT_SIZE, 128);
const_assert_eq!(REQUEST_SIZE, 160);

// From crates/robopoker-poker/src/state.rs
const_assert_eq!(CONFIG_SIZE, 128);
const_assert_eq!(TABLE_SIZE, 1136);
const_assert_eq!(STAKING_POOL_SIZE, 96);
const_assert_eq!(STAKER_POSITION_SIZE, 64);
```

## Migration Strategy

### Pre-Migration Checklist

Before any account layout change:

1. **Document the change**
   - Create a migration spec in `docs/migrations/`
   - List all affected accounts
   - Define old and new layouts
   - Calculate size deltas

2. **Assess impact**
   - Count affected accounts on-chain
   - Estimate compute budget for migration
   - Determine if migration can be atomic or requires batching

3. **Plan rollback**
   - Document rollback procedure
   - Ensure old code can read new layout (if possible)
   - Prepare emergency downgrade procedure

### Migration Patterns

#### Pattern 1: Additive (Preferred)

Add new fields to the end of the struct without changing existing fields.

```rust
// Before (v0)
pub struct Config {
    pub discriminator: u8,  // 0x01
    pub initialized: u8,
    pub authority: Pubkey,
}

// After (v1) - additive
pub struct Config {
    pub discriminator: u8,  // 0x11 (version 1)
    pub initialized: u8,
    pub authority: Pubkey,
    pub new_field: u64,     // Added at end
}
```

Migration: No data migration needed. Old accounts are valid with default values for new fields.

#### Pattern 2: Realloc Migration

When account size increases, use `realloc` instruction:

1. Deploy new program version with migration instruction
2. Call migration instruction for each affected account
3. Instruction reads old layout, reallocates, writes new layout

```rust
pub fn migrate_config_v0_to_v1(
    accounts: &[AccountInfo],
) -> ProgramResult {
    let config = &accounts[0];

    // Verify old version
    let data = config.try_borrow_data()?;
    require!(data[0] & 0xF0 == 0x00, "Already migrated");

    // Realloc to new size
    let new_size = CONFIG_V1_SIZE;
    config.realloc(new_size, true)?;

    // Copy data and update discriminator
    let mut data = config.try_borrow_mut_data()?;
    data[0] = (data[0] & 0x0F) | 0x10;  // Set version to 1

    Ok(())
}
```

#### Pattern 3: Account Recreation

For incompatible changes, create new accounts and migrate state:

1. Deploy new program with dual-read capability
2. Create new accounts with new layout
3. Copy state from old to new
4. Update references in dependent accounts
5. Close old accounts (return rent)

### Migration Testing Requirements

Before executing any migration on mainnet:

1. **Unit tests**
   - Old layout parsing
   - New layout parsing
   - Migration function correctness
   - Version detection

2. **Integration tests**
   - Migrate synthetic accounts in test validator
   - Verify all account types still function
   - Test rollback procedure

3. **Devnet rehearsal**
   - Execute full migration on devnet
   - Monitor for errors and performance
   - Document actual vs. estimated times

4. **Testnet staging**
   - Final rehearsal with realistic account counts
   - Full E2E verification post-migration

## Migration Test Plan Template

Create `docs/migrations/MIGRATION_vX_to_vY.md`:

```markdown
# Migration: vX to vY

## Summary
- **Accounts affected**: [list]
- **Size change**: [old] -> [new] bytes
- **Estimated compute**: [CU per account]
- **Total accounts to migrate**: [count from devnet/testnet/mainnet]

## Changes
| Field | Before | After | Notes |
|-------|--------|-------|-------|
| new_field | N/A | u64 | Added for XYZ |

## Pre-Migration Checklist
- [ ] Migration spec reviewed
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Devnet migration successful
- [ ] Testnet migration successful
- [ ] Rollback procedure documented
- [ ] Monitoring dashboards prepared
- [ ] Communication plan ready

## Execution Steps
1. [ ] Pause dependent services
2. [ ] Deploy new program
3. [ ] Execute migration (batch size: N)
4. [ ] Verify all accounts migrated
5. [ ] Resume services
6. [ ] Monitor for 24h

## Rollback Steps
1. [ ] Pause services
2. [ ] Deploy previous program version
3. [ ] Execute reverse migration (if applicable)
4. [ ] Verify account integrity
5. [ ] Resume services

## Post-Migration Verification
- [ ] All accounts readable
- [ ] All program instructions functional
- [ ] No degraded performance
- [ ] SDK compatibility confirmed
```

## SDK Version Coordination

Account layout changes MUST coordinate with SDK releases:

1. SDK MUST support reading both old and new layouts during migration window
2. SDK MUST bump major version for incompatible layout changes
3. SDK changelog MUST document migration steps for integrators

See `docs/release-engineering/SDK_COMPATIBILITY.md` for SDK versioning policy.
