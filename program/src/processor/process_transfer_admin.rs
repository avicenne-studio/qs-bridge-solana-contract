use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{state::global_state::GlobalState, utils::deserialize_and_validate_pda};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct TransferAdminArgs {
    pub new_admin: Pubkey,
}

pub fn process_transfer_admin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: TransferAdminArgs,
) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let admin_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;

    if !admin_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    if *admin_ai.key != global_state.admin {
        return Err(ProgramError::IncorrectAuthority);
    }

    global_state.pending_admin = Some(args.new_admin);

    let mut data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut data[..])?;

    Ok(())
}
