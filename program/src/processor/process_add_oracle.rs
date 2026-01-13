use borsh::{BorshDeserialize, BorshSerialize};
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::{
    constants::SEED_ORACLE,
    state::{global_state::GlobalState, oracle::Oracle},
    utils::deserialize_and_validate_pda,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct AddOracleArgs {
    pub oracle_pubkey: Pubkey,
}

pub fn process_add_oracle(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: AddOracleArgs,
) -> ProgramResult {
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

    if !oracle_ai.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let (expected_oracle_pda, oracle_bump) =
        Pubkey::find_program_address(&[SEED_ORACLE, &args.oracle_pubkey.to_bytes()], program_id);

    if expected_oracle_pda != *oracle_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let oracle = Oracle::new(args.oracle_pubkey, oracle_bump);

    let size = Oracle::SPACE;
    let lamports = Rent::get()?.minimum_balance(size);

    let create_ix = system_instruction::create_account(
        admin_ai.key,
        oracle_ai.key,
        lamports,
        size as u64,
        program_id,
    );

    let signer_seeds = &[SEED_ORACLE, &args.oracle_pubkey.to_bytes(), &[oracle_bump]];

    invoke_signed(
        &create_ix,
        &[
            admin_ai.clone(),
            oracle_ai.clone(),
            system_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    let mut data = oracle_ai.try_borrow_mut_data()?;
    oracle.serialize(&mut &mut data[..])?;

    global_state.oracle_count = global_state
        .oracle_count
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut global_state_data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut global_state_data[..])?;

    Ok(())
}
