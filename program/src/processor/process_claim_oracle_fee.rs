use borsh::BorshSerialize;
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction as token_instruction;

use crate::{
    constants::SEED_GLOBAL_STATE,
    state::{global_state::GlobalState, oracle::Oracle},
    utils::deserialize_and_validate_pda,
};

pub fn process_claim_oracle_fee(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let claimer_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let oracle_ai = next_account_info(acc_iter)?;
    let oracle_owner_ai = next_account_info(acc_iter)?;
    let token_mint_ai = next_account_info(acc_iter)?;
    let oracle_ata_ai = next_account_info(acc_iter)?;
    let token_program_ai = next_account_info(acc_iter)?;
    let associated_token_program_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;

    if !claimer_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *token_program_ai.key != spl_token::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    if *system_program_ai.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    if *associated_token_program_ai.key != spl_associated_token_account::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let global_state: GlobalState = deserialize_and_validate_pda(program_id, global_state_ai)?;
    let mut oracle: Oracle = deserialize_and_validate_pda(program_id, oracle_ai)?;

    if *oracle_owner_ai.key != oracle.oracle_pubkey {
        return Err(ProgramError::InvalidAccountData);
    }
    // Verify that the claimer is either the admin or the oracle user
    let is_admin = *claimer_ai.key == global_state.admin;
    let is_oracle_user = *claimer_ai.key == oracle.oracle_pubkey;

    if !is_admin && !is_oracle_user {
        return Err(ProgramError::IncorrectAuthority);
    }
    if *token_mint_ai.key != global_state.token_mint {
        return Err(ProgramError::InvalidAccountData);
    }
    if oracle.claimable_balance == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    let expected_oracle_ata = spl_associated_token_account::get_associated_token_address(
        &oracle_owner_ai.key,
        token_mint_ai.key,
    );

    if expected_oracle_ata != *oracle_ata_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    if oracle_ata_ai.data_is_empty() {
        let ix = spl_associated_token_account::instruction::create_associated_token_account(
            claimer_ai.key,
            oracle_owner_ai.key,
            token_mint_ai.key,
            token_program_ai.key,
        );
        invoke(
            &ix,
            &[
                claimer_ai.clone(),
                oracle_ata_ai.clone(),
                oracle_owner_ai.clone(),
                token_mint_ai.clone(),
                system_program_ai.clone(),
                token_program_ai.clone(),
                associated_token_program_ai.clone(),
            ],
        )?;
    }

    let amount_to_claim = oracle.claimable_balance;

    let signer_seeds = &[SEED_GLOBAL_STATE, &[global_state.bump]];
    let mint_ix = token_instruction::mint_to(
        token_program_ai.key,
        token_mint_ai.key,
        oracle_ata_ai.key,
        global_state_ai.key,
        &[],
        amount_to_claim,
    )?;

    invoke_signed(
        &mint_ix,
        &[
            token_mint_ai.clone(),
            oracle_ata_ai.clone(),
            global_state_ai.clone(),
            token_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    oracle.claimable_balance = 0;
    let mut oracle_data = oracle_ai.try_borrow_mut_data()?;
    oracle.serialize(&mut &mut oracle_data[..])?;

    Ok(())
}
