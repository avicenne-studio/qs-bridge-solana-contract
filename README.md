# qs-bridge

A Solana smart contract for cross-chain bridging functionality.

## Governance

This project is open source and maintained by Avicenne as part of the Qubic incubation program.

## Features

- **Inbound/Outbound Orders** - Process cross-chain transfers in both directions
- **Oracle System** - Multi-oracle support for transaction validation
- **Pause Controls** - Emergency pause functionality with authorized pausers
- **Admin Controls** - Manage oracles, pausers, and global state

## Quick Start

### Prerequisites

- Rust (with `cargo build-sbf` support)
- Node.js
- Solana CLI tools

### Installation

```bash
npm install
cargo build-sbf
```

### Running Tests

```bash
npm run test
```

## Project Structure

```
├── program/src/      # Rust smart contract
│   ├── processor/    # Instruction handlers
│   ├── state/        # Account structures
│   └── events/       # Event definitions
├── clients/js/       # Auto-generated TypeScript client
├── tests/            # Integration tests
└── scripts/          # Build and code generation scripts
```

## Deployment

**Current program address:** `9HzXq7P6UEQjJCrvbPCt4eZRvkoJU9jo1mSssbMHkncQ`
**Upgrade authority:** `oracle/.temp/solana-admin.json`

See [oracle/DEVNET_TEMP_GUIDE.md § Deploy / Upgrade](../oracle/DEVNET_TEMP_GUIDE.md) for the full build → deploy → re-initialize procedure, including the account-size caveat when `OutboundOrder::SPACE` changes.

The `oracle/src/clients/js/` and `hub/src/clients/js/` directories are **hand-maintained copies** of the generated client. After running `npm run idl:all`, manually mirror changes to `accounts/outboundOrder.ts`, `errors/qsBridge.ts`, `programs/qsBridge.ts`, and `pdas/` in both.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

