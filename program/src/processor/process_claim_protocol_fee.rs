use borsh::BorshSerialize;
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::instruction as token_instruction;

use crate::{
    constants::SEED_GLOBAL_STATE, state::global_state::GlobalState,
    utils::deserialize_and_validate_pda,
};

pub fn process_claim_protocol_fee(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let protocol_fee_recipient_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let token_mint_ai = next_account_info(acc_iter)?;
    let protocol_fee_recipient_ata_ai = next_account_info(acc_iter)?;
    let token_program_ai = next_account_info(acc_iter)?;
    let associated_token_program_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;

    if !protocol_fee_recipient_ai.is_signer {
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

    let mut global_state: GlobalState = deserialize_and_validate_pda(program_id, global_state_ai)?;

    if *protocol_fee_recipient_ai.key != global_state.protocol_fee_recipient {
        return Err(ProgramError::IncorrectAuthority);
    }

    if *token_mint_ai.key != global_state.token_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    if global_state.owed_protocol_fee == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let expected_protocol_fee_recipient_ata =
        spl_associated_token_account::get_associated_token_address(
            protocol_fee_recipient_ai.key,
            token_mint_ai.key,
        );

    if expected_protocol_fee_recipient_ata != *protocol_fee_recipient_ata_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    if protocol_fee_recipient_ata_ai.data_is_empty() {
        let ix = spl_associated_token_account::instruction::create_associated_token_account(
            protocol_fee_recipient_ai.key,
            protocol_fee_recipient_ai.key,
            token_mint_ai.key,
            token_program_ai.key,
        );
        solana_program::program::invoke(
            &ix,
            &[
                protocol_fee_recipient_ai.clone(),
                protocol_fee_recipient_ata_ai.clone(),
                protocol_fee_recipient_ai.clone(),
                token_mint_ai.clone(),
                system_program_ai.clone(),
                token_program_ai.clone(),
                associated_token_program_ai.clone(),
            ],
        )?;
    }

    let amount_to_claim = global_state.owed_protocol_fee;

    let signer_seeds = &[SEED_GLOBAL_STATE, &[global_state.bump]];
    let mint_ix = token_instruction::mint_to(
        token_program_ai.key,
        token_mint_ai.key,
        protocol_fee_recipient_ata_ai.key,
        global_state_ai.key,
        &[],
        amount_to_claim,
    )?;

    invoke_signed(
        &mint_ix,
        &[
            token_mint_ai.clone(),
            protocol_fee_recipient_ata_ai.clone(),
            global_state_ai.clone(),
            token_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    global_state.owed_protocol_fee = 0;
    let mut global_state_data = global_state_ai.try_borrow_mut_data()?;
    global_state.serialize(&mut &mut global_state_data[..])?;

    Ok(())
}
