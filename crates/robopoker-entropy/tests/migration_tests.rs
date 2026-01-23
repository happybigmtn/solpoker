//! Migration/versioning tests for entropy program accounts.
//!
//! AC-PR1.8: Versioned account layouts are tested before upgrades.

use robopoker_entropy::state::discriminator;

#[test]
fn test_entropy_discriminator_version_bits() {
    let config = discriminator::CONFIG;
    let commitment = discriminator::COMMITMENT;
    let request = discriminator::REQUEST;

    assert_eq!(discriminator::account_type(config), discriminator::CONFIG);
    assert_eq!(discriminator::account_type(commitment), discriminator::COMMITMENT);
    assert_eq!(discriminator::account_type(request), discriminator::REQUEST);

    assert_eq!(discriminator::account_version(config), 0);
    assert_eq!(discriminator::account_version(commitment), 0);
    assert_eq!(discriminator::account_version(request), 0);
}

#[test]
fn test_entropy_future_version_encoding() {
    let v1_config = 0x10 | discriminator::CONFIG;
    let v2_request = 0x20 | discriminator::REQUEST;

    assert_eq!(discriminator::account_version(v1_config), 1);
    assert_eq!(discriminator::account_type(v1_config), discriminator::CONFIG);

    assert_eq!(discriminator::account_version(v2_request), 2);
    assert_eq!(discriminator::account_type(v2_request), discriminator::REQUEST);
}
