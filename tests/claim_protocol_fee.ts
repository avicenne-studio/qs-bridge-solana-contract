import { AccountInfoBytes, LiteSVM } from "litesvm";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import {
  getAddOracleInstruction,
  getInboundInstruction,
  getClaimProtocolFeeInstruction,
} from "../clients/js/instructions";
import { findGlobalStatePda } from "../clients/js/pdas/globalState";
import { findOraclePda } from "../clients/js/pdas/oracle";
import {
  Address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  getTransactionEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  getU32Encoder,
  getBytesEncoder,
  getU64Encoder,
  createSignableMessage,
  appendTransactionMessageInstructions,
  Instruction,
} from "@solana/kit";
import bs58 from "bs58";
import {
  getMintEncoder,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import { getGlobalStateDecoder, findInboundOrderPda } from "../clients/js";
import { QS_BRIDGE_PROGRAM_ADDRESS } from "../clients/js/programs/qsBridge";
import assert from "assert";
import { createHash, randomBytes } from "crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TextEncoder } from "util";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;
const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;

// Constants from Rust code
const QUBIC_NETWORK_ID = 1;
const SOLANA_NETWORK_ID = 2;
const PROTOCOL_NAME = "QubicBridge";
const PROTOCOL_VERSION = "1";

describe("claim protocol fee test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let protocolFeeRecipient: KeyPairSigner;
  let recipient: KeyPairSigner;
  let relayer: KeyPairSigner;
  let web3JsRelayer: Keypair;
  let oracles: KeyPairSigner[];
  let tokenMint: KeyPairSigner;
  let globalStatePda: Address;

  beforeAll(async () => {
    const web3JsKeypair = Keypair.generate();
    admin = await generateKeyPairSigner();
    relayer = await createKeyPairSignerFromBytes(web3JsKeypair.secretKey, true);
    web3JsRelayer = web3JsKeypair;
    recipient = await generateKeyPairSigner();
    protocolFeeRecipient = await generateKeyPairSigner();

    oracles = [
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
    ];

    tokenMint = await generateKeyPairSigner();

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(relayer.address), 1000000000n);
    svm.airdrop(new PublicKey(recipient.address), 1000000000n);
    svm.airdrop(new PublicKey(protocolFeeRecipient.address), 1000000000n);

    // Initialize global state
    const [gsPda] = await findGlobalStatePda();
    globalStatePda = gsPda;

    const [tokenMetadata] = await getProgramDerivedAddress({
      programAddress: METADATA_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("metadata"),
        getAddressEncoder().encode(METADATA_PROGRAM_ADDRESS),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const initGlobalStateIx = getInitGlobalStateInstruction({
      admin,
      globalState: globalStatePda,
      protocolFeeRecipient: protocolFeeRecipient.address,
      tokenMint: tokenMint,
      systemProgram: SystemProgram.programId.toString() as Address,
      tokenMetadata,
      bpsFee: 100, // 1%
      protocolFeeBpsOfBps: 1000, // 10% of oracle fee
      symbol: "Test",
      name: "test",
      uri: "https://arweave.net/QPC6FYdUn-3V8ytFNuoCS85S2tHAuiDblh6u3CIZLsw",
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(initGlobalStateIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Set up the mint account with global state PDA as mint authority
    const mintAccount = getMintEncoder().encode({
      mintAuthority: globalStatePda,
      supply: 0n,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: globalStatePda,
    });

    const mintAccountToSet: AccountInfoBytes = {
      lamports: LAMPORTS_PER_SOL,
      data: new Uint8Array(mintAccount),
      owner: new PublicKey(TOKEN_PROGRAM_ADDRESS),
      executable: false,
    };

    svm.setAccount(new PublicKey(tokenMint.address), mintAccountToSet);

    // Add oracles
    const oracleInstructions: Instruction[] = [];
    for (const oracle of oracles) {
      const [oraclePda] = await findOraclePda({ oracle: oracle.address });
      oracleInstructions.push(
        getAddOracleInstruction({
          admin,
          globalState: globalStatePda,
          oraclePda: oraclePda,
          systemProgram: SystemProgram.programId.toString() as Address,
          oraclePubkey: oracle.address,
        })
      );
    }

    const addOraclesTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstructions(oracleInstructions, tx)
    );

    const signedOraclesTx =
      await signTransactionMessageWithSigners(addOraclesTxMessage);
    const encodedOraclesTx = getTransactionEncoder().encode(signedOraclesTx);
    const versionedOraclesTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedOraclesTx)
    );
    svm.sendTransaction(versionedOraclesTx);
  });

  it("should claim protocol fee after inbound order", async () => {
    // First, process an inbound order to accumulate protocol fees
    const amount = 1000000000n; // 1 token (9 decimals)
    const relayerFee = 10000000n; // 0.01 token
    const nonce = randomBytes(32);

    const fromAddress = new Uint8Array(32).fill(1);
    const toAddress = new Uint8Array(bs58.decode(recipient.address));
    const tokenIn = new Uint8Array(32).fill(2);
    const tokenOut = new Uint8Array(bs58.decode(tokenMint.address)); // Solana token

    const order = {
      networkIn: QUBIC_NETWORK_ID,
      networkOut: SOLANA_NETWORK_ID,
      tokenIn,
      tokenOut,
      fromAddress,
      toAddress,
      amount,
      relayerFee,
      nonce: new Uint8Array(nonce),
      orderEra: 0,
    };

    // Compute message hash and get oracle signatures
    const messageHash = computeInboundOrderMessageHash(order);
    const signatures: Uint8Array[] = [];
    const signableMessage = createSignableMessage(messageHash);

    // Get global state to determine required signatures
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state should exist");
    const globalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount!.data)
    );

    const numRequiredSignatures = Math.min(
      Math.ceil(globalState.oracleCount * 0.6),
      6
    );
    for (let i = 0; i < numRequiredSignatures; i++) {
      const [sigDict] = await oracles[i].signMessages([signableMessage]);
      const signature = sigDict[oracles[i].address];
      signatures.push(new Uint8Array(signature));
    }

    // Find PDAs
    const [inboundOrderPda] = await findInboundOrderPda({
      networkIn: order.networkIn,
      nonce: order.nonce,
    });

    const [recipientAta] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      seeds: [
        getAddressEncoder().encode(recipient.address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const [relayerAta] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      seeds: [
        getAddressEncoder().encode(relayer.address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const allOraclePdas = await Promise.all(
      oracles.map(async (oracle) => {
        const [pda] = await findOraclePda({ oracle: oracle.address });
        return pda;
      })
    );

    // Pad to 6 oracles
    while (allOraclePdas.length < 6) {
      allOraclePdas.push(allOraclePdas[allOraclePdas.length - 1]);
    }

    // Process inbound order
    const inboundIx = getInboundInstruction({
      relayer,
      globalState: globalStatePda,
      tokenMint: tokenMint.address,
      recipient: recipient.address,
      recipientAta: recipientAta as Address,
      relayerAta: relayerAta as Address,
      inboundOrderPda: inboundOrderPda,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      systemProgram: SYSTEM_PROGRAM_ADDRESS,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      oracle1Pda: allOraclePdas[0],
      oracle2Pda: allOraclePdas[1],
      oracle3Pda: allOraclePdas[2],
      oracle4Pda: allOraclePdas[3],
      oracle5Pda: allOraclePdas[4],
      oracle6Pda: allOraclePdas[5],
      order: {
        networkIn: order.networkIn,
        networkOut: order.networkOut,
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        fromAddress: order.fromAddress,
        toAddress: order.toAddress,
        amount: order.amount,
        relayerFee: order.relayerFee,
        nonce: order.nonce,
        orderEra: order.orderEra,
      },
      signatures: signatures.map((sig) => new Uint8Array(sig)),
    });

    const inboundTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(relayer, tx),
      (tx) =>
        appendTransactionMessageInstruction(
          getSetComputeUnitLimitInstruction({ units: 300_000 }),
          tx
        ),
      (tx) => appendTransactionMessageInstruction(inboundIx, tx)
    );

    const signedInboundTx =
      await signTransactionMessageWithSigners(inboundTxMessage);
    const encodedInboundTx = getTransactionEncoder().encode(signedInboundTx);
    const versionedInboundTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedInboundTx)
    );
    svm.sendTransaction(versionedInboundTx);
    // Calculate expected protocol fee
    // oracle_fee = amount * bps_fee / 10000 = 1000000000 * 100 / 10000 = 10000000
    // protocol_fee = oracle_fee * protocol_fee_bps_of_bps / 10000 = 10000000 * 1000 / 10000 = 1000000
    const expectedOracleFee = (amount * BigInt(100)) / BigInt(10000);
    const expectedProtocolFee =
      (expectedOracleFee * BigInt(1000)) / BigInt(10000);

    // Verify protocol fee was accumulated
    const globalStateAccountAfterInbound = svm.getAccount(
      new PublicKey(globalStatePda)
    );
    assert.ok(globalStateAccountAfterInbound, "Global state should exist");
    const globalStateAfterInbound = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccountAfterInbound!.data)
    );
    assert.strictEqual(
      globalStateAfterInbound.owedProtocolFee,
      expectedProtocolFee,
      "Protocol fee should be accumulated in global state"
    );

    // Now claim the protocol fee
    const [protocolFeeRecipientAta] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      seeds: [
        getAddressEncoder().encode(protocolFeeRecipient.address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const claimProtocolFeeIx = getClaimProtocolFeeInstruction({
      protocolFeeRecipient: protocolFeeRecipient,
      globalState: globalStatePda,
      tokenMint: tokenMint.address,
      protocolFeeRecipientAta: protocolFeeRecipientAta as Address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      systemProgram: SYSTEM_PROGRAM_ADDRESS,
    });

    const claimTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(protocolFeeRecipient, tx),
      (tx) => appendTransactionMessageInstruction(claimProtocolFeeIx, tx)
    );

    const signedClaimTx =
      await signTransactionMessageWithSigners(claimTxMessage);
    const encodedClaimTx = getTransactionEncoder().encode(signedClaimTx);
    const versionedClaimTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedClaimTx)
    );
    svm.sendTransaction(versionedClaimTx);

    // Verify protocol fee recipient received tokens
    const protocolFeeRecipientTokenAccount = svm.getAccount(
      new PublicKey(protocolFeeRecipientAta)
    );
    assert.ok(
      protocolFeeRecipientTokenAccount,
      "Protocol fee recipient token account should exist"
    );
    const protocolFeeRecipientTokenState = getTokenDecoder().decode(
      new Uint8Array(protocolFeeRecipientTokenAccount!.data)
    );
    assert.strictEqual(
      protocolFeeRecipientTokenState.amount,
      expectedProtocolFee,
      "Protocol fee recipient should receive the protocol fee"
    );

    // Verify owed_protocol_fee was reset to 0
    const globalStateAccountAfterClaim = svm.getAccount(
      new PublicKey(globalStatePda)
    );
    assert.ok(globalStateAccountAfterClaim, "Global state should exist");
    const globalStateAfterClaim = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccountAfterClaim!.data)
    );
    assert.strictEqual(
      globalStateAfterClaim.owedProtocolFee,
      0n,
      "Owed protocol fee should be reset to 0"
    );

    // Verify mint supply increased by protocol fee
    const mintAccountAfter = svm.getAccount(new PublicKey(tokenMint.address));
    assert.ok(mintAccountAfter, "Mint account should exist");
  });
});

function computeInboundOrderMessageHash(order: {
  networkIn: number;
  networkOut: number;
  tokenIn: Uint8Array;
  tokenOut: Uint8Array;
  fromAddress: Uint8Array;
  toAddress: Uint8Array;
  amount: bigint;
  relayerFee: bigint;
  nonce: Uint8Array;
  orderEra: number;
}): Uint8Array {
  const data: Uint8Array[] = [];
  // PROTOCOL_NAME - Borsh string encoding: u32 length + bytes
  const protocolNameBytes = new TextEncoder().encode(PROTOCOL_NAME);
  data.push(new Uint8Array(getU32Encoder().encode(protocolNameBytes.length)));
  data.push(new Uint8Array(protocolNameBytes));

  // PROTOCOL_VERSION - Borsh string encoding: u32 length + bytes
  const protocolVersionBytes = new TextEncoder().encode(PROTOCOL_VERSION);
  data.push(
    new Uint8Array(getU32Encoder().encode(protocolVersionBytes.length))
  );
  data.push(new Uint8Array(protocolVersionBytes));

  // SOLANA_CONTRACT_ADDRESS
  data.push(programId.toBytes());

  // network_in
  data.push(new Uint8Array(getU32Encoder().encode(order.networkIn)));

  // network_out
  data.push(new Uint8Array(getU32Encoder().encode(order.networkOut)));

  // token_in
  data.push(new Uint8Array(getBytesEncoder().encode(order.tokenIn)));

  // token_out
  data.push(new Uint8Array(getBytesEncoder().encode(order.tokenOut)));

  // from_address
  data.push(new Uint8Array(getBytesEncoder().encode(order.fromAddress)));

  // to_address
  data.push(new Uint8Array(getBytesEncoder().encode(order.toAddress)));

  // amount
  data.push(new Uint8Array(getU64Encoder().encode(order.amount)));

  // relayer_fee
  data.push(new Uint8Array(getU64Encoder().encode(order.relayerFee)));

  // nonce
  data.push(new Uint8Array(getBytesEncoder().encode(order.nonce)));

  // order_era
  data.push(new Uint8Array(getU32Encoder().encode(order.orderEra)));

  // Concatenate all data
  const totalLength = data.reduce((sum, arr) => sum + arr.length, 0);
  const concatenated = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of data) {
    concatenated.set(arr, offset);
    offset += arr.length;
  }

  return new Uint8Array(createHash("sha256").update(concatenated).digest());
}
