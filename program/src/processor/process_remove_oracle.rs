use borsh::BorshSerialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    error::QSBridgeError,
    state::{global_state::GlobalState, oracle::Oracle},
    utils::deserialize_and_validate_pda,
};

pub fn process_remove_oracle(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let admin_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let oracle_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;

    if !admin_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *system_program_ai.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut global_state: GlobalState = deserialize_and_validate_pda(program_id, global_state_ai)?;

    if *admin_ai.key != global_state.admin {
        return Err(ProgramError::IncorrectAuthority);
    }

    let oracle = deserialize_and_validate_pda::<Oracle>(program_id, oracle_ai)?;

    if oracle.claimable_balance > 0 {
        return Err(QSBridgeError::OracleHasClaimableBalance.into());
    }

    global_state.oracle_count = global_state
        .oracle_count
        .checked_sub(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut global_state_data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut global_state_data[..])?;

    let lamports = oracle_ai.lamports();

    **oracle_ai.lamports.borrow_mut() = 0;
    **admin_ai.lamports.borrow_mut() = admin_ai
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut data = oracle_ai.try_borrow_mut_data()?;
    data.fill(0);

    oracle_ai.assign(&solana_program::system_program::id());

    Ok(())
}
