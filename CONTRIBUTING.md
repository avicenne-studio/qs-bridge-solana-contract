# Contributing to qs-bridge

## Overview

qs-bridge is a Solana smart contract for cross-chain bridging functionality. The project uses Rust for the on-chain program and TypeScript for testing and client integration.

## Project Structure

```
├── program/src/      # Rust smart contract
│   ├── instruction.rs
│   ├── processor/    # Instruction handlers
│   ├── state/        # Account structures
│   └── error.rs
├── clients/js/       # Auto-generated TypeScript client (DO NOT EDIT)
├── tests/            # Integration tests
└── scripts/          # Build and code generation scripts
```

## Prerequisites

- Rust (with `cargo build-sbf` support)
- Node.js
- Solana CLI tools

## Setup

```bash
npm install
cargo build-sbf
```

## Development Workflow

1. **Smart contract changes** - Edit files in `program/src/`
2. **Regenerate clients** - Run `npm run idl:all` after modifying instructions
3. **Write tests** - Add TypeScript tests in `tests/`
4. **Run tests** - Execute `npm run test`

## Commands

| Command | Description |
|---------|-------------|
| `npm run test` | Build program and run all tests |
| `npm run idl:shank` | Generate IDL from Rust code |
| `npm run idl:codama` | Generate TypeScript client from IDL |
| `npm run idl:all` | Generate IDL and TypeScript client |

## Important Notes

- **Do not edit `clients/js/`** - This directory is auto-generated from the IDL
- Tests use LiteSVM for local Solana simulation
- Target the `develop` branch for pull requests

## Testing

Tests are written in TypeScript using Jest and LiteSVM:

```bash
npm run test
```

## Pull Requests

1. Create a feature branch from `develop`
2. Make your changes
3. Run `npm run idl:all` if you modified instructions
4. Ensure all tests pass with `npm run test`
5. Submit a PR to `develop`
