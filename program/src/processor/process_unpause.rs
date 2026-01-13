use borsh::BorshSerialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    state::{global_state::GlobalState, pauser::Pauser},
    utils::deserialize_and_validate_pda,
};

pub fn process_unpause(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let pauser_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let pauser_pda_ai = next_account_info(acc_iter)?;

    if !pauser_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    let pauser: Pauser = deserialize_and_validate_pda(program_id, pauser_pda_ai)?;

    if *pauser_ai.key != pauser.pauser_pubkey {
        return Err(ProgramError::IncorrectAuthority);
    }

    global_state.paused = false;

    let mut data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut data[..])?;

    Ok(())
}
