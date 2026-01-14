use borsh::{BorshDeserialize, BorshSerialize};
use shank::ShankInstruction;

use crate::processor::{
    process_add_oracle::AddOracleArgs, process_add_pauser::AddPauserArgs,
    process_inbound::InboundArgs, process_init_global_state::InitGlobalStateArgs,
    process_outbound::OutboundOrderArgs, process_override_outbound::OverrideOutboundArgs,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, ShankInstruction)]
#[rustfmt::skip]
pub enum QSBridgeInstruction {
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, name = "Protocol Fee Recipient", desc = "Protocol Fee Recipient")]
    #[account(3, writable, signer, name = "Token Mint", desc = "Token Mint")]
    #[account(4, writable, name = "Token Metadata", desc = "Token Metadata")]
    #[account(5, name = "System Program", desc = "System Program Account")]
    #[account(6, name = "Token Program", desc = "Token Program Account")]
    #[account(7, name = "Token Metadata Program", desc = "Token Metadata Program Account")]
    InitGlobalState(InitGlobalStateArgs),
    #[account(0, writable, signer, name = "User", desc = "User who is locking tokens")]
    #[account(1, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Outbound Order", desc = "Outbound Order PDA")]
    #[account(3, writable, name = "User Token Account", desc = "User's token account to burn from")]
    #[account(4, writable, name = "Token Mint", desc = "Token Mint")]
    #[account(5, name = "Token Program", desc = "Token Program Account")]
    #[account(6, name = "System Program", desc = "System Program Account")]
    Outbound(OutboundOrderArgs),
    #[account(0, writable, signer, name = "Caller", desc = "Caller who owns the order")]
    #[account(1, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Outbound Order", desc = "Outbound Order PDA")]
    OverrideOutbound(OverrideOutboundArgs),
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Pauser PDA", desc = "Pauser PDA")]
    #[account(3, name = "System Program", desc = "System Program Account")]
    AddPauser(AddPauserArgs),
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Pauser PDA", desc = "Pauser PDA")]
    #[account(3, name = "System Program", desc = "System Program Account")]
    RemovePauser,
    #[account(0, writable, signer, name = "Pauser", desc = "Pauser")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, name = "Pauser PDA", desc = "Pauser PDA")]
    Pause,
    #[account(0, writable, signer, name = "Pauser", desc = "Pauser")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, name = "Pauser PDA", desc = "Pauser PDA")]
    Unpause,
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Oracle PDA", desc = "Oracle PDA")]
    #[account(3, name = "System Program", desc = "System Program Account")]
    AddOracle(AddOracleArgs),
    #[account(0, writable, signer, name = "Admin", desc = "Admin")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Oracle PDA", desc = "Oracle PDA")]
    #[account(3, name = "System Program", desc = "System Program Account")]
    RemoveOracle,
    #[account(0, writable, signer, name = "Relayer", desc = "Relayer")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Token Mint", desc = "Token Mint")]
    #[account(3, name = "Recipient", desc = "Recipient")]
    #[account(4, writable, name = "Recipient ATA", desc = "Recipient Associated Token Account")]
    #[account(5, writable, name = "Relayer ATA", desc = "Relayer Associated Token Account")]
    #[account(6, writable, name = "InboundOrder PDA", desc = "InboundOrder PDA")]
    #[account(7, name = "Token Program", desc = "Token Program Account")]
    #[account(8, name = "System Program", desc = "System Program Account")]
    #[account(9, name = "Associated Token Program", desc = "Associated Token Program Account")]
    #[account(10, writable, name = "Oracle 1 PDA", desc = "Oracle 1 PDA")]
    #[account(11, writable, name = "Oracle 2 PDA", desc = "Oracle 2 PDA")]
    #[account(12, writable, name = "Oracle 3 PDA", desc = "Oracle 3 PDA")]
    #[account(13, writable, name = "Oracle 4 PDA", desc = "Oracle 4 PDA")]
    #[account(14, writable, name = "Oracle 5 PDA", desc = "Oracle 5 PDA")]
    #[account(15, writable, name = "Oracle 6 PDA", desc = "Oracle 6 PDA")]
    Inbound(InboundArgs),
    #[account(0, writable, signer, name = "Protocol Fee Recipient", desc = "Protocol Fee Recipient")]
    #[account(1, writable, name = "Global State", desc = "Global State")]
    #[account(2, writable, name = "Token Mint", desc = "Token Mint")]
    #[account(3, writable, name = "Protocol Fee Recipient ATA", desc = "Protocol Fee Recipient Associated Token Account")]
    #[account(4, name = "Token Program", desc = "Token Program Account")]
    #[account(5, name = "Associated Token Program", desc = "Associated Token Program Account")]
    #[account(6, name = "System Program", desc = "System Program Account")]
    ClaimProtocolFee,
}
