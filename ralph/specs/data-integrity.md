# Data Integrity & Indexing Spec

## Indexing Pipeline
- AC-DATA1.1: Off-chain indexer ingests table and hand events from RPC/Geyser with a defined schema.
- AC-DATA1.2: Indexer is idempotent and handles reorgs or duplicate events safely.
- AC-DATA1.3: Indexer maintains checkpoints and can resume from last confirmed slot.

## Reconciliation + Retention
- AC-DATA1.4: Reconciliation tooling compares indexed state to on-chain state and reports drift.
- AC-DATA1.5: Data retention and backup policies are defined and tested.
