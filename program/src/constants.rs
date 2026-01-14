pub const SEED_GLOBAL_STATE: &[u8] = b"global_state";
pub const SEED_ORACLE: &[u8] = b"oracle";
pub const SEED_PAUSER: &[u8] = b"pauser";
pub const SEED_OUTBOUND_ORDER: &[u8] = b"outbound_order";
pub const SEED_INBOUND_ORDER: &[u8] = b"inbound_order";

pub const PROTOCOL_NAME: &str = "QubicBridge";
pub const PROTOCOL_VERSION: &str = "1";
pub const QUBIC_NETWORK_ID: u32 = 1;
pub const SOLANA_NETWORK_ID: u32 = 2;
pub const QUBIC_CONTRACT_ADDRESS: [u8; 32] = [0u8; 32];
pub const TOKEN_DECIMALS: u8 = 9;
pub const MAX_REQUIRED_ORACLE_SIG_COUNT: u32 = 6;
pub const REQUIRED_ORACLE_SIG_BPS: u32 = 6_000; // 60%
