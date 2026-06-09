#![allow(unexpected_cfgs)]
pub mod constants;
pub mod entrypoint;
pub mod error;
pub mod events;
pub mod instruction;
pub mod processor;
pub mod state;
pub mod traits;
pub mod utils;

use solana_program::declare_id;

declare_id!("9HzXq7P6UEQjJCrvbPCt4eZRvkoJU9jo1mSssbMHkncQ");
