use num_derive::FromPrimitive;
use solana_program::{msg, program_error::ProgramError};
use thiserror::Error;

#[derive(Error, Clone, Debug, Eq, PartialEq, FromPrimitive)]
pub enum QSBridgeError {}

impl From<QSBridgeError> for ProgramError {
    fn from(e: QSBridgeError) -> Self {
        msg!("QS-BRIDGE: {:?}", e.to_string());
        ProgramError::Custom(e as u32)
    }
}
