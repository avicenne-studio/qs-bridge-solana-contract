use num_derive::FromPrimitive;
use solana_program::{msg, program_error::ProgramError};
use thiserror::Error;

#[derive(Error, Clone, Debug, Eq, PartialEq, FromPrimitive)]
pub enum QSBridgeError {
    #[error("Program is paused")]
    ProgramPaused,
    #[error("Unsupported network")]
    UnsupportedNetwork,
    #[error("Unsupported out token")]
    UnsupportedOutToken,
    #[error("Oracle has claimable balance")]
    OracleHasClaimableBalance,
    #[error("Invalid number of signatures")]
    InvalidNumberOfSignatures,
    #[error("Duplicate oracle signature detected")]
    DuplicateOracleSignature,
    #[error("Invalid relayer fee")]
    InvalidRelayerFee,
    #[error("Override attempt limit reached")]
    MaxOverridesReached,
}

impl From<QSBridgeError> for ProgramError {
    fn from(e: QSBridgeError) -> Self {
        msg!("QS-BRIDGE: {:?}", e.to_string());
        ProgramError::Custom(e as u32)
    }
}
