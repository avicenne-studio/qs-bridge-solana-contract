use borsh::{BorshDeserialize, BorshSerialize};
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    log::sol_log_data,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::instruction as token_instruction;

use crate::{
    constants::{QUBIC_CONTRACT_ADDRESS, QUBIC_NETWORK_ID, SEED_OUTBOUND_ORDER, SOLANA_NETWORK_ID},
    error::QSBridgeError,
    events::OutboundEvent,
    state::{global_state::GlobalState, outbound_order::OutboundOrder},
    utils::deserialize_and_validate_pda,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct OutboundOrderArgs {
    pub network_out: u32,
    pub token_out: [u8; 32],
    pub to_address: [u8; 32],
    pub amount: u64,
    pub relayer_fee: u64,
    pub nonce: [u8; 32],
}

pub fn process_outbound(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: OutboundOrderArgs,
) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let user_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let outbound_order_ai = next_account_info(acc_iter)?;
    let user_token_account_ai = next_account_info(acc_iter)?;
    let token_mint_ai = next_account_info(acc_iter)?;
    let token_program_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;

    if !user_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *token_program_ai.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    if *system_program_ai.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    if global_state.paused {
        return Err(QSBridgeError::ProgramPaused.into());
    }

    if *token_mint_ai.key != global_state.token_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    if args.amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    if args.network_out != QUBIC_NETWORK_ID {
        return Err(QSBridgeError::UnsupportedNetwork.into());
    }
    if args.token_out != QUBIC_CONTRACT_ADDRESS {
        return Err(QSBridgeError::UnsupportedOutToken.into());
    }

    let oracle_fee = (args.amount as u128)
        .checked_mul(global_state.bps_fee.into())
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    let protocol_fee = (oracle_fee as u128)
        .checked_mul(global_state.protocol_fee_bps_of_bps.into())
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    let total_fee = oracle_fee
        .checked_add(protocol_fee)
        .and_then(|v| v.checked_add(args.relayer_fee))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;
    if total_fee >= args.amount {
        return Err(QSBridgeError::InvalidRelayerFee.into());
    }

    if !outbound_order_ai.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let (expected_outbound_pda, outbound_bump) = Pubkey::find_program_address(
        &[
            SEED_OUTBOUND_ORDER,
            &args.network_out.to_le_bytes(),
            &args.nonce,
        ],
        program_id,
    );

    if expected_outbound_pda != *outbound_order_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let outbound_order = OutboundOrder::new(
        args.network_out,
        global_state.token_mint.to_bytes(),
        args.token_out,
        user_ai.key.to_bytes(),
        args.to_address,
        args.amount,
        args.relayer_fee,
        args.nonce,
        outbound_bump,
    );

    let size = OutboundOrder::SPACE;
    let lamports = Rent::get()?.minimum_balance(size);

    let create_ix = system_instruction::create_account(
        user_ai.key,
        outbound_order_ai.key,
        lamports,
        size as u64,
        program_id,
    );

    let signer_seeds = &[
        SEED_OUTBOUND_ORDER,
        &args.network_out.to_le_bytes(),
        &args.nonce,
        &[outbound_bump],
    ];

    invoke_signed(
        &create_ix,
        &[
            user_ai.clone(),
            outbound_order_ai.clone(),
            system_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    let mut data = outbound_order_ai.try_borrow_mut_data()?;
    outbound_order.serialize(&mut &mut data[..])?;

    let burn_amount = args.amount as u64;
    let burn_ix = token_instruction::burn(
        token_program_ai.key,
        user_token_account_ai.key,
        token_mint_ai.key,
        user_ai.key,
        &[],
        burn_amount,
    )?;

    invoke(
        &burn_ix,
        &[
            user_token_account_ai.clone(),
            token_mint_ai.clone(),
            user_ai.clone(),
            token_program_ai.clone(),
        ],
    )?;

    let outbound_event = OutboundEvent {
        network_in: SOLANA_NETWORK_ID,
        network_out: args.network_out,
        token_in: global_state.token_mint.to_bytes(),
        token_out: args.token_out,
        from_address: user_ai.key.to_bytes(),
        to_address: args.to_address,
        amount: args.amount,
        relayer_fee: args.relayer_fee,
        nonce: args.nonce,
    };

    let event_data = outbound_event.try_to_vec()?;
    sol_log_data(&[&event_data]);

    Ok(())
}
