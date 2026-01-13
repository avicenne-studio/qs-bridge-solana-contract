use borsh::{BorshDeserialize, BorshSerialize};
use mpl_token_metadata::{self, instructions::CreateMetadataAccountV3CpiBuilder, types::DataV2};
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::{
    constants::{SEED_GLOBAL_STATE, TOKEN_DECIMALS},
    state::global_state::GlobalState,
};

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct InitGlobalStateArgs {
    pub bps_fee: u16,
    pub protocol_fee_bps_of_bps: u16,
    pub uri: String,
    pub name: String,
    pub symbol: String,
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
    let token_mint_ai = next_account_info(acc_iter)?;
    let token_metadata_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;
    let token_program_ai = next_account_info(acc_iter)?;
    let token_metadata_program_ai = next_account_info(acc_iter)?;

    if !payer_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *token_program_ai.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    if *system_program_ai.key != solana_program::system_program::id() {
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

    if args.bps_fee > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }

    if args.protocol_fee_bps_of_bps > 10_000 {
        return Err(ProgramError::InvalidArgument);
    }

    let mint_space = spl_token::state::Mint::LEN;
    let mint_lamports = Rent::get()?.minimum_balance(mint_space);
    let ix = system_instruction::create_account(
        payer_ai.key,
        token_mint_ai.key,
        mint_lamports,
        mint_space as u64,
        token_program_ai.key,
    );
    invoke(
        &ix,
        &[
            payer_ai.clone(),
            token_mint_ai.clone(),
            system_program_ai.clone(),
        ],
    )?;

    let ix = spl_token::instruction::initialize_mint2(
        token_program_ai.key,
        token_mint_ai.key,
        global_state_ai.key,
        Some(global_state_ai.key),
        TOKEN_DECIMALS,
    )?;

    invoke(&ix, &[token_mint_ai.clone(), token_program_ai.clone()])?;

    let mint_metadata = DataV2 {
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    let signer_seeds = &[SEED_GLOBAL_STATE, &[global_state_bump]];
    CreateMetadataAccountV3CpiBuilder::new(token_metadata_program_ai)
        .metadata(token_metadata_ai)
        .mint(token_mint_ai)
        .mint_authority(global_state_ai)
        .payer(payer_ai)
        .update_authority(global_state_ai, true)
        .system_program(system_program_ai)
        .data(mint_metadata)
        .is_mutable(true)
        .invoke_signed(&[signer_seeds])?;

    let global_state = GlobalState::new(
        *payer_ai.key,
        *protocol_fee_recipient_ai.key,
        *token_mint_ai.key,
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
            system_program_ai.clone(),
        ],
        &[&[SEED_GLOBAL_STATE, &[global_state_bump]]],
    )?;

    let mut data = global_state_ai.try_borrow_mut_data()?;

    global_state.serialize(&mut &mut data[..])?;

    Ok(())
}
