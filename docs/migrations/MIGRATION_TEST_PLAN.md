# Migration Test Plan (AC-PR1.8)

This document defines the testing requirements for account layout migrations.

## Overview

Before any account migration is executed on mainnet, it must pass through this test plan. This ensures data integrity and minimizes risk of loss.

## Test Phases

### Phase 1: Unit Tests

Location: `crates/robopoker-*/tests/migration_tests.rs`

#### Required Tests

1. **Version detection**
   ```rust
   #[test]
   fn test_detect_version_v0() {
       let data = create_v0_account();
       assert_eq!(detect_version(&data), 0);
   }

   #[test]
   fn test_detect_version_v1() {
       let data = create_v1_account();
       assert_eq!(detect_version(&data), 1);
   }
   ```

2. **Old layout parsing**
   ```rust
   #[test]
   fn test_parse_v0_config() {
       let data = create_v0_config_bytes();
       let config = Config::from_v0_bytes(&data).unwrap();
       assert!(config.is_initialized());
   }
   ```

3. **New layout parsing**
   ```rust
   #[test]
   fn test_parse_v1_config() {
       let data = create_v1_config_bytes();
       let config = Config::from_bytes(&data).unwrap();
       assert!(config.is_initialized());
       assert!(config.new_field.is_some());
   }
   ```

4. **Migration function**
   ```rust
   #[test]
   fn test_migrate_v0_to_v1() {
       let old_data = create_v0_config_bytes();
       let new_data = migrate_config(&old_data).unwrap();

       // Verify data integrity
       let old_config = Config::from_v0_bytes(&old_data).unwrap();
       let new_config = Config::from_bytes(&new_data).unwrap();

       assert_eq!(old_config.authority, new_config.authority);
       assert_eq!(old_config.initialized, new_config.initialized);
   }
   ```

5. **Rollback function** (if applicable)
   ```rust
   #[test]
   fn test_rollback_v1_to_v0() {
       let v1_data = create_v1_config_bytes();
       let v0_data = rollback_config(&v1_data).unwrap();

       let config = Config::from_v0_bytes(&v0_data).unwrap();
       assert!(config.is_initialized());
   }
   ```

### Phase 2: Integration Tests

Location: `crates/robopoker-*/tests/migration_integration_tests.rs`

#### Test Validator Setup

```rust
async fn setup_test_validator() -> (BanksClient, Keypair, Hash) {
    let program = read_program_binary();
    let test_validator = TestValidator::new()
        .add_program(PROGRAM_ID, program)
        .start()
        .await;
    // ...
}
```

#### Required Tests

1. **End-to-end migration**
   ```rust
   #[tokio::test]
   async fn test_migration_e2e() {
       let (client, payer, _) = setup_test_validator().await;

       // Create old account
       let old_account = create_v0_account(&client, &payer).await;

       // Execute migration instruction
       let result = migrate_account(&client, &payer, old_account).await;
       assert!(result.is_ok());

       // Verify new layout
       let account_data = client.get_account(old_account).await.unwrap();
       let config = Config::from_bytes(&account_data.data).unwrap();
       assert_eq!(detect_version(&account_data.data), 1);
   }
   ```

2. **All instructions work post-migration**
   ```rust
   #[tokio::test]
   async fn test_all_instructions_post_migration() {
       let (client, payer, _) = setup_test_validator().await;

       // Setup and migrate
       let account = create_and_migrate_account(&client, &payer).await;

       // Test each instruction
       assert!(test_create_table(&client, &payer, account).await.is_ok());
       assert!(test_join_table(&client, &payer, account).await.is_ok());
       // ... all other instructions
   }
   ```

3. **Partial migration state**
   ```rust
   #[tokio::test]
   async fn test_mixed_version_accounts() {
       let (client, payer, _) = setup_test_validator().await;

       // Create one old, one new account
       let old_account = create_v0_account(&client, &payer).await;
       let new_account = create_v1_account(&client, &payer).await;

       // Verify both work correctly
       assert!(read_account(&client, old_account).await.is_ok());
       assert!(read_account(&client, new_account).await.is_ok());
   }
   ```

### Phase 3: Devnet Rehearsal

Execute the migration on devnet with real accounts.

#### Pre-Rehearsal Checklist

- [ ] Devnet has representative account data
- [ ] Migration script prepared
- [ ] Monitoring in place
- [ ] Team available for rollback

#### Rehearsal Steps

1. **Snapshot current state**
   ```bash
   # Export all program accounts
   solana account <CONFIG_PDA> --output json > backup/config.json
   solana account <TABLE_1> --output json > backup/table_1.json
   # ... etc
   ```

2. **Deploy new program**
   ```bash
   ./scripts/deploy-devnet.sh
   ```

3. **Execute migration**
   ```bash
   # For each account type
   ./scripts/migrate-accounts.sh --env devnet --type config
   ./scripts/migrate-accounts.sh --env devnet --type table
   ```

4. **Verify migration**
   ```bash
   ./scripts/verify-migration.sh --env devnet
   ```

5. **Run smoke tests**
   ```bash
   cd clients/ts
   npm run test:devnet
   ```

#### Rehearsal Pass Criteria

- [ ] All accounts migrated successfully
- [ ] No data loss detected
- [ ] All program instructions functional
- [ ] SDK can read all accounts
- [ ] Performance within acceptable bounds

### Phase 4: Testnet Staging

Final rehearsal with production-like conditions.

#### Testnet Requirements

- Account count similar to mainnet
- Representative account data variety
- Full monitoring enabled

#### Staging Steps

Same as devnet, but with stricter verification:

1. **Pre-migration audit**
   ```bash
   ./scripts/audit-accounts.sh --env testnet > pre_migration_audit.json
   ```

2. **Migration execution**
   With full logging and timing metrics

3. **Post-migration audit**
   ```bash
   ./scripts/audit-accounts.sh --env testnet > post_migration_audit.json
   diff pre_migration_audit.json post_migration_audit.json
   ```

4. **Extended testing**
   - Run full integration test suite
   - Run load tests
   - Monitor for 24-48 hours

### Phase 5: Mainnet Execution

Only after all previous phases pass.

#### Mainnet Checklist

- [ ] All previous phases passed
- [ ] Rollback procedure tested
- [ ] Communication plan executed
- [ ] Maintenance window scheduled
- [ ] On-call team available
- [ ] Monitoring dashboards ready

## Test Scripts

### Config Validation Test

```bash
#!/usr/bin/env bash
# tests/config-validation-test.sh

set -euo pipefail

echo "Testing config validation..."

# Test valid configs
./scripts/validate-config.sh --env devnet
./scripts/validate-config.sh --env testnet

# Mainnet should fail until program IDs are set
if ./scripts/validate-config.sh --env mainnet 2>/dev/null; then
    echo "ERROR: Mainnet validation should fail without program IDs"
    exit 1
fi

echo "Config validation tests PASSED"
```

### Migration Smoke Test

```typescript
// tests/migration-smoke.ts
import { createRpc } from '../src/utils/rpc';
import { decodeEntropyConfig, decodePokerConfig } from '../src';

async function smokeTest() {
  const rpc = createRpc();

  // Read and decode accounts
  const entropyConfig = await rpc.getAccountInfo(ENTROPY_CONFIG_PDA);
  const decoded = decodeEntropyConfig(entropyConfig.data);

  // Verify critical fields
  assert(decoded.discriminator !== 0, 'Invalid discriminator');
  assert(decoded.initialized, 'Config not initialized');

  console.log('Smoke test PASSED');
}
```

## Metrics to Track

During migration execution:

1. **Accounts processed**: Count per account type
2. **Errors**: Any failures with account addresses
3. **Compute units**: Average CU per migration transaction
4. **Time elapsed**: Total migration duration
5. **Retry count**: Transactions that needed retry

## Emergency Procedures

### Rollback Trigger Conditions

Initiate rollback if:
- More than 1% of accounts fail to migrate
- Any critical account fails (config PDAs)
- Compute budget exceeded for batch
- Unexpected behavior observed

### Rollback Procedure

1. **Stop migration** - Halt any in-progress batches
2. **Assess damage** - Count migrated vs. unmigrated
3. **Deploy old program** - If needed for compatibility
4. **Execute reverse migration** - If data must be reverted
5. **Verify state** - Ensure all accounts readable
6. **Post-mortem** - Document what went wrong
