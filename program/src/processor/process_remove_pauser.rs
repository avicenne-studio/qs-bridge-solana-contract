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

pub fn process_remove_pauser(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let admin_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let pauser_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;

    if !admin_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *system_program_ai.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let global_state: GlobalState = deserialize_and_validate_pda(program_id, global_state_ai)?;

    if *admin_ai.key != global_state.admin {
        return Err(ProgramError::IncorrectAuthority);
    }

    deserialize_and_validate_pda::<Pauser>(program_id, pauser_ai)?;

    let lamports = pauser_ai.lamports();

    **pauser_ai.lamports.borrow_mut() = 0;
    **admin_ai.lamports.borrow_mut() = admin_ai
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut data = pauser_ai.try_borrow_mut_data()?;
    data.fill(0);

    pauser_ai.assign(&solana_program::system_program::id());

    Ok(())
}
