use borsh::{BorshDeserialize, BorshSerialize};
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::{constants::SEED_GLOBAL_STATE, state::global_state::GlobalState};

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct InitGlobalStateArgs {
    pub bps_fee: u16,
    pub protocol_fee_bps_of_bps: u16,
    pub oracle_threshold_percent: u8,
}

pub fn process_init_global_state(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: InitGlobalStateArgs,
) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let payer_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let protocol_fee_recipient_ai = next_account_info(acc_iter)?;
    let oracle_fee_recipient_ai = next_account_info(acc_iter)?;
    let token_mint_ai = next_account_info(acc_iter)?;
    let system_program = next_account_info(acc_iter)?;

    if !payer_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system_program.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }
    let (global_state_pda, global_state_bump) =
        Pubkey::find_program_address(&[SEED_GLOBAL_STATE], program_id);
    if global_state_pda != *global_state_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    if !global_state_ai.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    if args.oracle_threshold_percent == 0 || args.oracle_threshold_percent > 100 {
        return Err(ProgramError::InvalidArgument);
    }

    if args.bps_fee > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }

    if args.protocol_fee_bps_of_bps > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }

    if *token_mint_ai.owner != spl_token::ID {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let mint_data = token_mint_ai.try_borrow_data()?;
    spl_token::state::Mint::unpack(&mint_data).map_err(|_| ProgramError::InvalidAccountData)?;

    let global_state = GlobalState::new(
        *payer_ai.key,
        *protocol_fee_recipient_ai.key,
        *oracle_fee_recipient_ai.key,
        *token_mint_ai.key,
        args.oracle_threshold_percent,
        args.bps_fee,
        args.protocol_fee_bps_of_bps,
        global_state_bump,
    );
    let size = GlobalState::SPACE;
    let lamports = Rent::get()?.minimum_balance(size);

    let create_ix = system_instruction::create_account(
        payer_ai.key,
        &global_state_pda,
        lamports,
        size as u64,
        program_id,
    );
    invoke_signed(
        &create_ix,
        &[
            payer_ai.clone(),
            global_state_ai.clone(),
            system_program.clone(),
        ],
        &[&[SEED_GLOBAL_STATE, &[global_state_bump]]],
    )?;

    let mut data = global_state_ai.try_borrow_mut_data()?;

    global_state.serialize(&mut &mut data[..])?;

    Ok(())
}
