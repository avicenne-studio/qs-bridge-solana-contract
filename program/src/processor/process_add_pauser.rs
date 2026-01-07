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
    constants::SEED_PAUSER,
    state::{global_state::GlobalState, pauser::Pauser},
    utils::deserialize_and_validate_pda,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct AddPauserArgs {
    pub pauser_pubkey: Pubkey,
}

pub fn process_add_pauser(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: AddPauserArgs,
) -> ProgramResult {
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

    let global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    if *admin_ai.key != global_state.admin {
        return Err(ProgramError::IncorrectAuthority);
    }

    if !pauser_ai.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let (expected_pauser_pda, pauser_bump) =
        Pubkey::find_program_address(&[SEED_PAUSER, &args.pauser_pubkey.to_bytes()], program_id);

    if expected_pauser_pda != *pauser_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let pauser = Pauser::new(args.pauser_pubkey, pauser_bump);

    let size = Pauser::SPACE;
    let lamports = Rent::get()?.minimum_balance(size);

    let create_ix = system_instruction::create_account(
        admin_ai.key,
        pauser_ai.key,
        lamports,
        size as u64,
        program_id,
    );

    let signer_seeds = &[SEED_PAUSER, &args.pauser_pubkey.to_bytes(), &[pauser_bump]];

    invoke_signed(
        &create_ix,
        &[
            admin_ai.clone(),
            pauser_ai.clone(),
            system_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    let mut data = pauser_ai.try_borrow_mut_data()?;
    pauser.serialize(&mut &mut data[..])?;

    Ok(())
}
