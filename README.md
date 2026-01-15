# qs-bridge

A Solana smart contract for cross-chain bridging functionality.

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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

