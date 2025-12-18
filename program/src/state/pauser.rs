use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankAccount;
use solana_program::pubkey::Pubkey;

use crate::{constants::SEED_PAUSER, state::Key, traits::PdaSeeds};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankAccount)]
pub struct Pauser {
    pub key: Key,
    pub pauser_pubkey: Pubkey,
    pub bump: u8,
}

impl Pauser {
    pub const SPACE: usize = std::mem::size_of::<Pauser>();
    pub fn new(pauser_pubkey: Pubkey, bump: u8) -> Self {
        Self {
            key: Key::Pauser,
            pauser_pubkey,
            bump,
        }
    }
}

impl PdaSeeds for Pauser {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8) {
        (
            vec![SEED_PAUSER.to_vec(), self.pauser_pubkey.to_bytes().to_vec()],
            self.bump,
        )
    }
}
