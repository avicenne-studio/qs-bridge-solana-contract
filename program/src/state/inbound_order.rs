use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankAccount;
use solana_program::{
    hash::{hash, Hash},
    pubkey::Pubkey,
};

use crate::{
    constants::{PROTOCOL_NAME, PROTOCOL_VERSION, SEED_INBOUND_ORDER, SOLANA_NETWORK_ID},
    state::Key,
    traits::PdaSeeds,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankAccount)]
pub struct InboundOrder {
    pub key: Key,
    pub network_in: u32,
    pub nonce: [u8; 32],
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct Domain {
    pub protocol_name: String,
    pub protocol_version: String,
    pub destination_chain_id: u32,
    pub contract_address: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct OrderData {
    pub network_in: u32,
    pub network_out: u32,
    pub token_in: [u8; 32],
    pub token_out: [u8; 32],
    pub from_address: [u8; 32],
    pub to_address: [u8; 32],
    pub amount: u64,
    pub relayer_fee: u64,
    pub nonce: [u8; 32],
    pub order_era: u32,
}

impl InboundOrder {
    pub const SPACE: usize = 1 + 4 + 32 + 1;
    pub fn new(network_in: u32, nonce: [u8; 32], bump: u8) -> Self {
        Self {
            key: Key::InboundOrder,
            network_in,
            nonce,
            bump,
        }
    }

    pub fn get_inbound_order_message_hash(
        order: &OrderData,
        token_mint: &Pubkey,
        program_id: &Pubkey,
    ) -> Hash {
        // - PROTOCOL_NAME ("QubicBridge"): 4 + 11 = 15 bytes
        // - PROTOCOL_VERSION ("1"): 4 + 1 = 5 bytes
        // - SOLANA_CONTRACT_ADDRESS ([u8; 32]): 32 bytes
        // - network_in (u32): 4 bytes
        // - network_out (u32): 4 bytes
        // - token_in ([u8; 32]): 32 bytes
        // - token_out ([u8; 32]): 32 bytes
        // - from_address ([u8; 32]): 32 bytes
        // - to_address ([u8; 32]): 32 bytes
        // - amount (u64): 8 bytes
        // - relayer_fee (u64): 8 bytes
        // - nonce ([u8; 32]): 32 bytes
        // - order_era (u32): 4 bytes
        // Total: 240 bytes, using 300 for headroom
        let mut data = Vec::with_capacity(300);

        PROTOCOL_NAME
            .to_string()
            .serialize(&mut data)
            .expect("Protocol name serialization failed");
        PROTOCOL_VERSION
            .to_string()
            .serialize(&mut data)
            .expect("Protocol version serialization failed");
        program_id
            .serialize(&mut data)
            .expect("Contract address serialization failed");
        order
            .network_in
            .serialize(&mut data)
            .expect("Network in serialization failed");
        SOLANA_NETWORK_ID
            .serialize(&mut data)
            .expect("Network out serialization failed");
        order
            .token_in
            .serialize(&mut data)
            .expect("Token in serialization failed");
        token_mint
            .to_bytes()
            .serialize(&mut data)
            .expect("Token out serialization failed");
        order
            .from_address
            .serialize(&mut data)
            .expect("From address serialization failed");
        order
            .to_address
            .serialize(&mut data)
            .expect("To address serialization failed");
        order
            .amount
            .serialize(&mut data)
            .expect("Amount serialization failed");
        order
            .relayer_fee
            .serialize(&mut data)
            .expect("Relayer fee serialization failed");
        order
            .nonce
            .serialize(&mut data)
            .expect("Nonce serialization failed");
        order
            .order_era
            .serialize(&mut data)
            .expect("Order era serialization failed");

        hash(&data)
    }
}

impl PdaSeeds for InboundOrder {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8) {
        (
            vec![
                SEED_INBOUND_ORDER.to_vec(),
                self.network_in.to_le_bytes().to_vec(),
                self.nonce.to_vec(),
            ],
            self.bump,
        )
    }
}
