use borsh::{BorshDeserialize, BorshSerialize};

/// Event emitted when an outbound order is overridden (to_address or relayer_fee updated)
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct OverrideOutboundEvent {
    pub discriminator: u8,
    pub to_address: [u8; 32],
    pub relayer_fee: u64,
    pub nonce: [u8; 32],
}
