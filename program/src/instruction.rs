use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankInstruction;

use crate::processor::process_init_global_state::InitGlobalStateArgs;

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankInstruction)]
#[rustfmt::skip]
pub enum QSBridgeInstruction {
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, name = "Protocol Fee Recipient", desc = "Protocol Fee Recipient")]
    #[account(3, name = "Oracle Fee Recipient", desc = "Oracle Fee Recipient")]
    #[account(4, name = "Token Mint", desc = "Token Mint")]
    #[account(5, name = "System Program", desc = "System Program Account")]
    InitGlobalState(InitGlobalStateArgs),
}
