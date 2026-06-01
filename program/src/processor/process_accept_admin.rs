use borsh::BorshSerialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{state::global_state::GlobalState, utils::deserialize_and_validate_pda};

pub fn process_accept_admin(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let pending_admin_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;

    if !pending_admin_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    match global_state.pending_admin {
        Some(expected) if expected == *pending_admin_ai.key => {}
        _ => return Err(ProgramError::IncorrectAuthority),
    }

    global_state.admin = *pending_admin_ai.key;
    global_state.pending_admin = None;

    let mut data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut data[..])?;

    Ok(())
}
