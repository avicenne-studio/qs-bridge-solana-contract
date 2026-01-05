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

declare_id!("qSBGtee9tspoDVmb867Wq6tcR3kp19XN1PbBVckrH7H");
