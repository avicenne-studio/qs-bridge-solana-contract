use borsh::{BorshDeserialize, BorshSerialize};

/// Event emitted when tokens are minted in an inbound order
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InboundEvent {
    pub discriminator: u8,
    pub network_in: u32,
    pub network_out: u32,
    pub token_in: [u8; 32],
    pub token_out: [u8; 32],
    pub from_address: [u8; 32],
    pub to_address: [u8; 32],
    pub amount: u64,
    pub relayer_fee: u64,
    pub nonce: [u8; 32],
}
