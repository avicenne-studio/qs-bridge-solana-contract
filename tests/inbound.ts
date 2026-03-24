import { AccountInfoBytes, LiteSVM } from "litesvm";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import { getAddOracleInstruction } from "../clients/js/instructions";
import { getInboundInstruction } from "../clients/js/instructions/inbound";
import { findGlobalStatePda } from "../clients/js/pdas/globalState";
import { findOraclePda } from "../clients/js/pdas/oracle";
import {} from "@solana/programs";
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
  compressTransactionMessageUsingAddressLookupTables,
} from "@solana/kit";
import bs58 from "bs58";
import {
  getMintEncoder,
  getMintDecoder,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import {
  getGlobalStateDecoder,
  getOracleDecoder,
  getInboundOrderDecoder,
  getInboundEventDecoder,
  Key,
  findInboundOrderPda,
} from "../clients/js";
import { QS_BRIDGE_PROGRAM_ADDRESS } from "../clients/js/programs/qsBridge";
import * as assert from "assert";
import { TextEncoder } from "util";
import { createHash, randomBytes } from "crypto";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

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

// Helper function to compute the inbound order message hash (matching Rust implementation)
// Note: This uses Borsh serialization format for strings (length-prefixed)
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
    new Uint8Array(getU32Encoder().encode(protocolVersionBytes.length)),
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

describe("inbound test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let signer: KeyPairSigner;
  let recipient: KeyPairSigner;
  let relayer: KeyPairSigner;
  let web3JsRelayer: Keypair;
  let oracles: KeyPairSigner[];
  let tokenMint: KeyPairSigner;
  let globalStatePda: Address;
  let lutAddress: Address;

  beforeAll(async () => {
    const web3JsKeypair = Keypair.generate();
    admin = await generateKeyPairSigner();
    signer = await createKeyPairSignerFromBytes(web3JsKeypair.secretKey, true);
    recipient = await generateKeyPairSigner();
    relayer = signer;
    web3JsRelayer = web3JsKeypair;

    oracles = [
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
      await generateKeyPairSigner(),
    ];

    // Update oracle keypairs to match the signers (or vice versa)
    // Actually, let's use the keypairs directly and convert addresses
    tokenMint = await generateKeyPairSigner();

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(signer.address), 1000000000n);
    svm.airdrop(new PublicKey(recipient.address), 1000000000n);
    svm.airdrop(new PublicKey(relayer.address), 1000000000n);

    // Initialize global state
    const [gsPda] = await findGlobalStatePda();
    globalStatePda = gsPda;

    const protocolFeeRecipient = await generateKeyPairSigner();

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
      (tx) => appendTransactionMessageInstruction(initGlobalStateIx, tx),
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx),
    );
    svm.sendTransaction(versionedTx);

    // Set up the mint account
    const mintAccount = getMintEncoder().encode({
      mintAuthority: globalStatePda, // Global state PDA is the mint authority
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

    const instructions: Instruction[] = [];
    for (let oracle of oracles) {
      const [oraclePda] = await findOraclePda({
        oracle: oracle.address,
      });

      instructions.push(
        getAddOracleInstruction({
          admin,
          globalState: globalStatePda,
          oraclePda: oraclePda,
          systemProgram: SystemProgram.programId.toString() as Address,
          oraclePubkey: oracle.address,
        }),
      );
    }

    const oraclesTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
    );

    const signedOraclesTx =
      await signTransactionMessageWithSigners(oraclesTxMessage);
    const encodedOraclesTx = getTransactionEncoder().encode(signedOraclesTx);
    const versionedOraclesTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedOraclesTx),
    );
    svm.sendTransaction(versionedOraclesTx);

    const lut = await findAddressLookupTablePda({
      authority: admin.address,
      recentSlot: 0,
    });
    lutAddress = lut[0];
    const createLookupTableIx = getCreateLookupTableInstruction({
      address: lut,
      authority: admin,
      recentSlot: 0,
    });
    const extendLookupTableIx = getExtendLookupTableInstruction({
      address: lutAddress,
      addresses: [
        ...oracles.map((oracle) => oracle.address),
        globalStatePda,
        tokenMint.address,
        TOKEN_PROGRAM_ADDRESS,
        SYSTEM_PROGRAM_ADDRESS,
        ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      ],
      payer: admin,
      authority: admin,
    });

    const lutTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(createLookupTableIx, tx),
      (tx) => appendTransactionMessageInstruction(extendLookupTableIx, tx),
    );

    const signedLutTx = await signTransactionMessageWithSigners(lutTxMessage);
    const encodedLutTx = getTransactionEncoder().encode(signedLutTx);
    const versionedLutTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedLutTx),
    );
    svm.sendTransaction(versionedLutTx);
  });

  it("should process inbound order with oracle signatures", async () => {
    // Create order data
    const amount = 1000000000n; // 1 token (9 decimals)
    const relayerFee = 10000000n; // 0.01 token
    const nonce = randomBytes(32);

    const fromAddress = new Uint8Array(32).fill(1); // Qubic address
    const toAddress = new PublicKey(recipient.address).toBytes(); // Solana address
    const tokenIn = new Uint8Array(32).fill(2); // Qubic token
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

    // Get global state to get bps_fee
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state should exist");
    const globalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount!.data),
    );

    // Compute message hash
    const messageHash = computeInboundOrderMessageHash(order);

    // Sign with oracles using the keypairs
    const signatures: Uint8Array[] = [];
    const signableMessage = createSignableMessage(messageHash);
    for (let oracleKeypair of oracles) {
      const [sigDict] = await oracleKeypair.signMessages([signableMessage]);
      const signature = sigDict[oracleKeypair.address];
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
        getAddressEncoder().encode(TOKEN_PROGRAM_ID),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const [relayerAta] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      seeds: [
        getAddressEncoder().encode(relayer.address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ID),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const oraclePdas = await Promise.all(
      oracles.map(async (oracle) => {
        const [oraclePda] = await findOraclePda({
          oracle: oracle.address,
        });
        return oraclePda;
      }),
    );

    // Create process inbound instruction
    const processInboundIx = getInboundInstruction({
      relayer,
      globalState: globalStatePda,
      tokenMint: tokenMint.address,
      recipient: recipient.address,
      recipientAta: recipientAta as Address,
      relayerAta: relayerAta as Address,
      inboundOrderPda: inboundOrderPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId.toString() as Address,
      oracle1Pda: oraclePdas[0],
      oracle2Pda: oraclePdas[1],
      oracle3Pda: oraclePdas[2],
      oracle4Pda: oraclePdas[3],
      oracle5Pda: oraclePdas[4],
      oracle6Pda: oraclePdas[5],
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
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

    // Create transaction with oracle accounts
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(signer, tx),
      (tx) =>
        appendTransactionMessageInstruction(
          getSetComputeUnitLimitInstruction({ units: 300_000 }),
          tx,
        ),
      (tx) =>
        appendTransactionMessageInstruction(
          getSetComputeUnitPriceInstruction({ microLamports: 1000 }),
          tx,
        ),

      (tx) => appendTransactionMessageInstruction(processInboundIx, tx),
    );
    const compressedTransactionMessage =
      // avoid lite svm lut bug, should work on devnet and mainnet
      compressTransactionMessageUsingAddressLookupTables(txMessage, {
        // [lutAddress]: [
        //   ...oracles.map((oracle) => oracle.address),
        //   globalStatePda,
        //   tokenMint.address,
        //   TOKEN_PROGRAM_ADDRESS,
        //   SYSTEM_PROGRAM_ADDRESS,
        //   ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        // ],
      });
    const signedTx = await signTransactionMessageWithSigners(
      compressedTransactionMessage,
    );

    // assertIsTransactionWithinSizeLimit(signedTx);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx),
    );

    const res = svm.sendTransaction(versionedTx);
    const logs = (res as any).logs() as string[];

    const eventLog = logs.find((log) => log.startsWith("Program data:"));
    assert.ok(eventLog, "Event log should exist");

    const base64Data = eventLog.split("Program data: ")[1];
    const eventBytes = new Uint8Array(Buffer.from(base64Data, "base64"));
    const decodedEvent = getInboundEventDecoder().decode(eventBytes);

    assert.strictEqual(decodedEvent.discriminator, 0);
    assert.strictEqual(decodedEvent.networkIn, QUBIC_NETWORK_ID);
    assert.strictEqual(decodedEvent.networkOut, SOLANA_NETWORK_ID);
    assert.strictEqual(decodedEvent.amount, amount);
    assert.strictEqual(decodedEvent.relayerFee, relayerFee);

    // Verify inbound order was created
    const inboundOrderAccount = svm.getAccount(new PublicKey(inboundOrderPda));
    assert.ok(inboundOrderAccount, "Inbound order account should exist");

    const decodedInboundOrder = getInboundOrderDecoder().decode(
      new Uint8Array(inboundOrderAccount!.data),
    );
    assert.strictEqual(decodedInboundOrder.key, Key.InboundOrder);
    assert.strictEqual(decodedInboundOrder.networkIn, QUBIC_NETWORK_ID);
    assert.deepStrictEqual(
      Array.from(decodedInboundOrder.nonce),
      Array.from(nonce),
    );

    // Verify fees were calculated correctly
    // Oracle fee = (amount * bps_fee) / 10_000 = (1000000000 * 100) / 10000 = 10000000
    const expectedOracleFee = (amount * BigInt(globalState.bpsFee)) / 10000n;
    // Protocol fee = (oracle_fee * protocol_fee_bps_of_bps) / 10_000 = (10000000 * 1000) / 10000 = 1000000
    const expectedProtocolFee =
      (expectedOracleFee * BigInt(globalState.protocolFeeBpsOfBps)) / 10000n;
    // Remaining = amount - oracle_fee - relayer_fee - protocol_fee
    const expectedRemaining =
      amount - expectedOracleFee - relayerFee - expectedProtocolFee;

    // Verify protocol fee was added to global state
    const updatedGlobalStateAccount = svm.getAccount(
      new PublicKey(globalStatePda),
    );
    assert.ok(updatedGlobalStateAccount, "Updated global state should exist");
    const updatedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(updatedGlobalStateAccount!.data),
    );
    assert.strictEqual(
      updatedGlobalState.owedProtocolFee,
      expectedProtocolFee,
      "Protocol fee should be added to global state",
    );

    // Verify oracle balances were updated
    const updatedOracle1Account = svm.getAccount(new PublicKey(oraclePdas[0]));
    assert.ok(updatedOracle1Account, "Oracle 1 account should exist");
    const updatedOracle1 = getOracleDecoder().decode(
      new Uint8Array(updatedOracle1Account!.data),
    );
    // 60% need to sign
    const numRequiredSignatures = Math.min(
      Math.ceil(updatedGlobalState.oracleCount * 0.6),
      6,
    );

    const expectedOracleBalance =
      expectedOracleFee / BigInt(numRequiredSignatures);
    assert.strictEqual(
      updatedOracle1.claimableBalance,
      expectedOracleBalance,
      "Oracle 1 balance should be updated",
    );

    // Verify tokens were minted
    const recipientTokenAccountAfter = svm.getAccount(
      new PublicKey(recipientAta),
    );
    assert.ok(
      recipientTokenAccountAfter,
      "Recipient token account should exist",
    );
    const recipientTokenState = getTokenDecoder().decode(
      recipientTokenAccountAfter!.data,
    );

    assert.strictEqual(
      recipientTokenState.amount,
      expectedRemaining,
      "Recipient should receive remaining amount",
    );

    const relayerTokenAccountAfter = svm.getAccount(new PublicKey(relayerAta));
    assert.ok(relayerTokenAccountAfter, "Relayer token account should exist");
    const relayerTokenState = getTokenDecoder().decode(
      new Uint8Array(relayerTokenAccountAfter!.data),
    );
    assert.strictEqual(
      relayerTokenState.amount,
      relayerFee,
      "Relayer should receive relayer fee",
    );

    // Verify mint supply increased
    const mintAccountAfter = svm.getAccount(new PublicKey(tokenMint.address));
    assert.ok(mintAccountAfter, "Mint account should exist");
    const mintState = getMintDecoder().decode(
      new Uint8Array(mintAccountAfter!.data),
    );
    const expectedTotalMinted = expectedRemaining + relayerFee;
    assert.strictEqual(
      mintState.supply,
      expectedTotalMinted,
      "Mint supply should increase by remaining + relayer fee",
    );
  });
});
