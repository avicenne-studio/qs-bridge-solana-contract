pub mod global_state;
pub mod inbound_order;
pub mod oracle;
pub mod outbound_order;
pub mod pauser;

use borsh::{BorshDeserialize, BorshSerialize};
use num_derive::{FromPrimitive, ToPrimitive};

#[derive(
    Clone, Copy, BorshSerialize, BorshDeserialize, Debug, PartialEq, Eq, ToPrimitive, FromPrimitive,
)]
pub enum Key {
    GlobalState,
    Oracle,
    Pauser,
    InboundOrder,
    OutboundOrder,
}
