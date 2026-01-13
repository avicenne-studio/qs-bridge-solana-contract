use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankAccount;
use solana_program::pubkey::Pubkey;

use crate::{constants::SEED_ORACLE, state::Key, traits::PdaSeeds};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankAccount)]
pub struct Oracle {
    pub key: Key,
    pub oracle_pubkey: Pubkey,
    pub claimable_balance: u64,
    pub bump: u8,
}

impl Oracle {
    pub const SPACE: usize = 1 + 32 + 8 + 1;
    pub fn new(oracle_pubkey: Pubkey, bump: u8) -> Self {
        Self {
            key: Key::Oracle,
            oracle_pubkey,
            claimable_balance: 0,
            bump,
        }
    }
}

impl PdaSeeds for Oracle {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8) {
        (
            vec![SEED_ORACLE.to_vec(), self.oracle_pubkey.to_bytes().to_vec()],
            self.bump,
        )
    }
}
