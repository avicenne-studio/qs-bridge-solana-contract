use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankAccount;
use solana_program::pubkey::Pubkey;

use crate::{constants::SEED_GLOBAL_STATE, state::Key, traits::PdaSeeds};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankAccount)]
pub struct GlobalState {
    pub key: Key,
    pub admin: Pubkey,
    pub protocol_fee_recipient: Pubkey,
    pub token_mint: Pubkey,
    pub bps_fee: u16,
    pub protocol_fee_bps_of_bps: u16,
    pub paused: bool,
    pub oracle_threshold_percent: u8,
    pub oracle_count: u8,
    pub bump: u8,
}

impl GlobalState {
    pub const SPACE: usize = 1 + 32 + 32 + 32 + 2 + 2 + 1 + 1 + 1 + 1;
    pub fn new(
        admin: Pubkey,
        protocol_fee_recipient: Pubkey,
        token_mint: Pubkey,
        oracle_threshold_percent: u8,
        bps_fee: u16,
        protocol_fee_bps_of_bps: u16,
        bump: u8,
    ) -> Self {
        Self {
            key: Key::GlobalState,
            paused: false,
            oracle_count: 0,
            admin,
            protocol_fee_recipient,
            token_mint,
            oracle_threshold_percent,
            bps_fee,
            protocol_fee_bps_of_bps,
            bump,
        }
    }
}

impl PdaSeeds for GlobalState {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8) {
        (vec![SEED_GLOBAL_STATE.to_vec()], self.bump)
    }
}
