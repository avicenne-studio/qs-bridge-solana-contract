use borsh::{BorshDeserialize, BorshSerialize};
use brine_ed25519::sig_verify;
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
    constants::{
        MAX_REQUIRED_ORACLE_SIG_COUNT, REQUIRED_ORACLE_SIG_BPS, SEED_GLOBAL_STATE,
        SEED_INBOUND_ORDER,
    },
    error::QSBridgeError,
    events::InboundEvent,
    state::{
        global_state::GlobalState,
        inbound_order::{InboundOrder, OrderData},
        oracle::Oracle,
    },
    utils::deserialize_and_validate_pda,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct InboundArgs {
    pub order: OrderData,
    pub signatures: Vec<[u8; 64]>,
}

pub fn process_inbound(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: InboundArgs,
) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let relayer_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let token_mint_ai = next_account_info(acc_iter)?;
    let recipient_ai = next_account_info(acc_iter)?;
    let recipient_ata_ai = next_account_info(acc_iter)?;
    let relayer_ata_ai = next_account_info(acc_iter)?;
    let inbound_order_ai = next_account_info(acc_iter)?;
    let token_program_ai = next_account_info(acc_iter)?;
    let system_program_ai = next_account_info(acc_iter)?;
    let associated_token_program_ai = next_account_info(acc_iter)?;

    if !relayer_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *token_program_ai.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    if *system_program_ai.key != solana_program::system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    if global_state.paused {
        return Err(QSBridgeError::ProgramPaused.into());
    }

    if *token_mint_ai.key != global_state.token_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    if !inbound_order_ai.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let (expected_inbound_pda, inbound_bump) = Pubkey::find_program_address(
        &[
            SEED_INBOUND_ORDER,
            &args.order.network_in.to_le_bytes(),
            &args.order.nonce,
        ],
        program_id,
    );

    if expected_inbound_pda != *inbound_order_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let recipient_pubkey = Pubkey::new_from_array(args.order.to_address);

    if recipient_pubkey != *recipient_ai.key {
        return Err(ProgramError::InvalidArgument);
    }

    let expected_recipient_ata = spl_associated_token_account::get_associated_token_address(
        &Pubkey::new_from_array(args.order.to_address),
        token_mint_ai.key,
    );

    if expected_recipient_ata != *recipient_ata_ai.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let message_hash =
        InboundOrder::get_inbound_order_message_hash(&args.order, &token_mint_ai.key, program_id);
    let message_bytes = message_hash.as_ref();

    let num_of_required_signatures = ((global_state.oracle_count as u128)
        .checked_mul(REQUIRED_ORACLE_SIG_BPS.into())
        .and_then(|v| v.checked_add(9999))
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u32)
        .min(MAX_REQUIRED_ORACLE_SIG_COUNT) as usize;

    if args.signatures.len() < num_of_required_signatures {
        return Err(ProgramError::InvalidArgument);
    }

    let amount = args.order.amount;
    let relayer_fee = args.order.relayer_fee;

    let oracle_fee = (amount as u128)
        .checked_mul(global_state.bps_fee.into())
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    let protocol_fee = (oracle_fee as u128)
        .checked_mul(global_state.protocol_fee_bps_of_bps.into())
        .and_then(|v| v.checked_div(10_000))
        .ok_or(ProgramError::ArithmeticOverflow)? as u64;

    let remaining_amount = amount
        .checked_sub(oracle_fee)
        .and_then(|v| v.checked_sub(relayer_fee))
        .and_then(|v| v.checked_sub(protocol_fee))
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let mut valid_oracle_pubkeys = Vec::new();

    for signature in args.signatures.iter() {
        let oracle_ai = next_account_info(acc_iter)?;

        let mut oracle: Oracle = deserialize_and_validate_pda(program_id, oracle_ai)?;

        let public_key_bytes = oracle.oracle_pubkey.to_bytes();

        sig_verify(&public_key_bytes, signature, message_bytes)
            .map_err(|_| ProgramError::InvalidArgument)?;

        if valid_oracle_pubkeys.contains(&oracle.oracle_pubkey) {
            return Err(QSBridgeError::DuplicateOracleSignature.into());
        }

        valid_oracle_pubkeys.push(oracle.oracle_pubkey);

        if oracle_fee > 0 {
            let mut oracle_data = oracle_ai.try_borrow_mut_data()?;
            oracle.claimable_balance = oracle
                .claimable_balance
                .checked_add(
                    oracle_fee
                        .checked_div(num_of_required_signatures as u64)
                        .ok_or(ProgramError::ArithmeticOverflow)?,
                )
                .ok_or(ProgramError::ArithmeticOverflow)?;
            oracle.serialize(&mut &mut oracle_data[..])?;
        }
    }

    let signer_seeds = &[SEED_GLOBAL_STATE, &[global_state.bump]];

    if relayer_fee > 0 {
        if relayer_ata_ai.data_is_empty() {
            let ix = spl_associated_token_account::instruction::create_associated_token_account(
                relayer_ai.key,
                relayer_ai.key,
                token_mint_ai.key,
                token_program_ai.key,
            );
            invoke(
                &ix,
                &[
                    relayer_ai.clone(),
                    relayer_ata_ai.clone(),
                    relayer_ai.clone(),
                    token_mint_ai.clone(),
                    system_program_ai.clone(),
                    token_program_ai.clone(),
                    associated_token_program_ai.clone(),
                ],
            )?;
        }

        let mint_relayer_ix = token_instruction::mint_to(
            token_program_ai.key,
            token_mint_ai.key,
            relayer_ata_ai.key,
            &global_state_ai.key,
            &[],
            relayer_fee,
        )?;

        invoke_signed(
            &mint_relayer_ix,
            &[
                token_mint_ai.clone(),
                relayer_ata_ai.clone(),
                global_state_ai.clone(),
                token_program_ai.clone(),
            ],
            &[signer_seeds],
        )?;
    }

    if remaining_amount > 0 {
        if recipient_ata_ai.data_is_empty() {
            let ix = spl_associated_token_account::instruction::create_associated_token_account(
                relayer_ai.key,
                recipient_ai.key,
                token_mint_ai.key,
                token_program_ai.key,
            );
            invoke(
                &ix,
                &[
                    relayer_ai.clone(),
                    recipient_ata_ai.clone(),
                    recipient_ai.clone(),
                    token_mint_ai.clone(),
                    system_program_ai.clone(),
                    token_program_ai.clone(),
                    associated_token_program_ai.clone(),
                ],
            )?;
        }

        let mint_recipient_ix = token_instruction::mint_to(
            token_program_ai.key,
            token_mint_ai.key,
            recipient_ata_ai.key,
            &global_state_ai.key,
            &[],
            remaining_amount,
        )?;

        invoke_signed(
            &mint_recipient_ix,
            &[
                token_mint_ai.clone(),
                recipient_ata_ai.clone(),
                global_state_ai.clone(),
                token_program_ai.clone(),
            ],
            &[signer_seeds],
        )?;
    }

    let inbound_order = InboundOrder::new(args.order.network_in, args.order.nonce, inbound_bump);

    let size = InboundOrder::SPACE;
    let lamports = Rent::get()?.minimum_balance(size);

    let create_ix = system_instruction::create_account(
        relayer_ai.key,
        inbound_order_ai.key,
        lamports,
        size as u64,
        program_id,
    );

    let signer_seeds = &[
        SEED_INBOUND_ORDER,
        &args.order.network_in.to_le_bytes(),
        &args.order.nonce,
        &[inbound_bump],
    ];

    invoke_signed(
        &create_ix,
        &[
            relayer_ai.clone(),
            inbound_order_ai.clone(),
            system_program_ai.clone(),
        ],
        &[signer_seeds],
    )?;

    if protocol_fee > 0 {
        let mut global_state_data = global_state_ai.try_borrow_mut_data()?;
        global_state.owed_protocol_fee = global_state
            .owed_protocol_fee
            .checked_add(protocol_fee)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        global_state.serialize(&mut &mut global_state_data[..])?;
    }

    let mut data = inbound_order_ai.try_borrow_mut_data()?;
    inbound_order.serialize(&mut &mut data[..])?;

    let inbound_event = InboundEvent {
        discriminator: 0,
        network_in: args.order.network_in,
        network_out: args.order.network_out,
        token_in: args.order.token_in,
        token_out: args.order.token_out,
        from_address: args.order.from_address,
        to_address: args.order.to_address,
        amount: args.order.amount,
        relayer_fee: args.order.relayer_fee,
        nonce: args.order.nonce,
    };

    let event_data = inbound_event.try_to_vec()?;
    sol_log_data(&[&event_data]);

    Ok(())
}
