pub mod process_init_global_state;
pub mod process_outbound;
pub mod process_override_outbound;

use borsh::BorshDeserialize;
use {
    crate::instruction::QSBridgeInstruction, process_init_global_state::process_init_global_state,
    process_outbound::process_outbound, process_override_outbound::process_override_outbound,
};

use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let instruction = QSBridgeInstruction::try_from_slice(input)?;

    match instruction {
        QSBridgeInstruction::InitGlobalState(args) => {
            msg!("QS-BRIDGE: Initializing global state");
            process_init_global_state(program_id, accounts, args)
        }
        QSBridgeInstruction::Outbound(args) => {
            msg!("QS-BRIDGE: Processing outbound order");
            process_outbound(program_id, accounts, args)
        }
        QSBridgeInstruction::OverrideOutbound(args) => {
            msg!("QS-BRIDGE: Overriding outbound order");
            process_override_outbound(program_id, accounts, args)
        }
    }
}
