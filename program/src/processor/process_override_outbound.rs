use borsh::{BorshDeserialize, BorshSerialize};
#[allow(deprecated)]
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    log::sol_log_data,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    error::QSBridgeError,
    events::OverrideOutboundEvent,
    state::{global_state::GlobalState, outbound_order::OutboundOrder},
    utils::deserialize_and_validate_pda,
};

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct OverrideOutboundArgs {
    pub to_address: Option<[u8; 32]>,
    pub relayer_fee: Option<u64>,
}

pub fn process_override_outbound(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: OverrideOutboundArgs,
) -> ProgramResult {
    let acc_iter = &mut accounts.iter();

    let caller_ai = next_account_info(acc_iter)?;
    let global_state_ai = next_account_info(acc_iter)?;
    let outbound_order_ai = next_account_info(acc_iter)?;

    if !caller_ai.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let global_state: GlobalState =
        deserialize_and_validate_pda::<GlobalState>(program_id, global_state_ai)?;

    if global_state.paused {
        return Err(QSBridgeError::ProgramPaused.into());
    }

    let mut outbound_order: OutboundOrder =
        deserialize_and_validate_pda(program_id, outbound_order_ai)?;

    let caller_pubkey_bytes = caller_ai.key.to_bytes();
    if outbound_order.from_address != caller_pubkey_bytes {
        return Err(ProgramError::IncorrectAuthority);
    }

    if let Some(new_to_address) = args.to_address {
        outbound_order.to_address = new_to_address;
    }

    if let Some(new_relayer_fee) = args.relayer_fee {
        outbound_order.relayer_fee = new_relayer_fee;
    }

    let mut data = outbound_order_ai.try_borrow_mut_data()?;
    outbound_order.serialize(&mut &mut data[..])?;

    let override_event = OverrideOutboundEvent {
        to_address: outbound_order.to_address,
        relayer_fee: outbound_order.relayer_fee,
        nonce: outbound_order.nonce,
    };

    let event_data = override_event.try_to_vec()?;
    sol_log_data(&[&event_data]);

    Ok(())
}
