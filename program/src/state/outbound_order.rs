use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankAccount;

use crate::{
    constants::{SEED_OUTBOUND_ORDER, SOLANA_NETWORK_ID},
    state::Key,
    traits::PdaSeeds,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankAccount)]
pub struct OutboundOrder {
    pub key: Key,
    pub network_in: u32,
    pub network_out: u32,
    pub token_in: [u8; 32],
    pub token_out: [u8; 32],
    pub from_address: [u8; 32],
    pub to_address: [u8; 32],
    pub amount: u64,
    pub relayer_fee: u64,
    pub nonce: [u8; 32],
    pub bump: u8,
}

impl OutboundOrder {
    pub const SPACE: usize = 1 + 4 + 4 + 32 + 32 + 32 + 32 + 8 + 8 + 32 + 1;

    pub fn new(
        network_out: u32,
        token_in: [u8; 32],
        token_out: [u8; 32],
        from_address: [u8; 32],
        to_address: [u8; 32],
        amount: u64,
        relayer_fee: u64,
        nonce: [u8; 32],
        bump: u8,
    ) -> Self {
        Self {
            key: Key::OutboundOrder,
            network_in: SOLANA_NETWORK_ID,
            network_out,
            token_in,
            token_out,
            from_address,
            to_address,
            amount,
            relayer_fee,
            nonce,
            bump,
        }
    }
}

impl PdaSeeds for OutboundOrder {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8) {
        (
            vec![
                SEED_OUTBOUND_ORDER.to_vec(),
                self.network_out.to_le_bytes().to_vec(),
                self.nonce.to_vec(),
            ],
            self.bump,
        )
    }
}
