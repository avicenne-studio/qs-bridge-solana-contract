import { AccountInfoBytes, LiteSVM } from "litesvm";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getOutboundInstruction } from "../clients/js/instructions/outbound";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import { findGlobalStatePda } from "../clients/js/pdas/globalState";
import {
  Address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
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
  getBytesDecoder,
  getU32Decoder,
  getU64Decoder,
  getU128Decoder,
  fixDecoderSize,
  getStructDecoder,
} from "@solana/kit";
import {
  AccountState,
  getMintDecoder,
  getMintEncoder,
  getMintToInstruction,
  getTokenDecoder,
  getTokenEncoder,
} from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import {
  getGlobalStateDecoder,
  getOutboundOrderDecoder,
  Key,
  QS_BRIDGE_PROGRAM_ADDRESS,
} from "../clients/js";
import assert from "assert";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;

// Constants from Rust code
const QUBIC_NETWORK_ID = 1;
const QUBIC_CONTRACT_ADDRESS = new Uint8Array(32).fill(0);

describe("outbound test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let user: KeyPairSigner;
  let tokenMint: KeyPairSigner;
  let userTokenAccount: Address;
  let globalStatePda: Address;
  let tokenMintPubkey: PublicKey;
  let mintAmount: bigint;

  beforeAll(async () => {
    admin = await generateKeyPairSigner();
    user = await generateKeyPairSigner();
    tokenMint = await generateKeyPairSigner();
    tokenMintPubkey = new PublicKey(tokenMint.address);

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(user.address), 1000000000n);

    // Initialize global state first
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

    // Initialize global state using the init instruction (this also creates and initializes the mint)
    const initGlobalStateIx = getInitGlobalStateInstruction({
      admin,
      globalState: globalStatePda,
      protocolFeeRecipient: protocolFeeRecipient.address,
      tokenMint: tokenMint,
      systemProgram: SystemProgram.programId.toString() as Address,
      tokenMetadata,
      bpsFee: 100,
      protocolFeeBpsOfBps: 100,
      oracleThresholdPercent: 100,
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

    // Mint tokens to user
    mintAmount = 1000000000n;

    const [derivedUserTokenAccount] = await getProgramDerivedAddress({
      programAddress: TOKEN_PROGRAM_ID,
      seeds: [
        getAddressEncoder().encode(user.address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ID),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });
    userTokenAccount = derivedUserTokenAccount;

    const tokenAccount = getTokenEncoder().encode({
      mint: tokenMint.address,
      owner: user.address,
      amount: mintAmount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0,
      closeAuthority: null,
    });

    const tokenAccountToSet: AccountInfoBytes = {
      executable: false,
      owner: new PublicKey(TOKEN_PROGRAM_ID),
      lamports: LAMPORTS_PER_SOL,
      data: new Uint8Array(tokenAccount),
    };

    const mintAccountData = svm.getAccount(new PublicKey(tokenMint.address));
    const decodedMintAccount = getMintDecoder().decode(mintAccountData!.data);
    const mintAccountDataToSet = getMintEncoder().encode({
      ...decodedMintAccount,
      supply: mintAmount,
    });

    const mintAccountToSet: AccountInfoBytes = {
      executable: false,
      owner: new PublicKey(TOKEN_PROGRAM_ID),
      lamports: LAMPORTS_PER_SOL,
      data: new Uint8Array(mintAccountDataToSet),
    };

    svm.setAccount(new PublicKey(userTokenAccount), tokenAccountToSet);
    svm.setAccount(new PublicKey(tokenMint.address), mintAccountToSet);
  });

  it("should process outbound order and burn tokens", async () => {
    const tokenAccountData = svm.getAccount(new PublicKey(userTokenAccount));
    const decodedTokenAccount = getTokenDecoder().decode(
      tokenAccountData!.data
    );

    assert.equal(decodedTokenAccount.amount, mintAmount);

    // Verify tokens were minted by checking mint supply
    const mintAccountAfterMint = svm.getAccount(tokenMintPubkey);
    const decodedMintAfterMint = getMintDecoder().decode(
      mintAccountAfterMint!.data
    );
    assert.equal(decodedMintAfterMint.supply, mintAmount);

    // Also verify the token account exists
    const userTokenAccountData = svm.getAccount(
      new PublicKey(userTokenAccount)
    );
    assert.ok(userTokenAccountData, "User token account should exist");

    // Prepare outbound order parameters
    const networkOut = QUBIC_NETWORK_ID;
    const tokenOut = QUBIC_CONTRACT_ADDRESS;
    const toAddress = new Uint8Array(32).fill(1); // Example Qubic address
    const amount = 500000000n; // 0.5 tokens
    const relayerFee = 10000000n; // 0.01 tokens
    const nonce = new Uint8Array(32).fill(42); // Example nonce

    // Derive outbound order PDA
    const [outboundOrderPda, outboundBump] = await getProgramDerivedAddress({
      programAddress: QS_BRIDGE_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("outbound_order"),
        getU32Encoder().encode(networkOut),
        getBytesEncoder().encode(nonce),
      ],
    });

    // Create outbound instruction
    const outboundIx = getOutboundInstruction({
      user,
      globalState: globalStatePda,
      outboundOrder: outboundOrderPda,
      userTokenAccount: userTokenAccount as Address,
      tokenMint: tokenMint.address,
      tokenProgram:
        TOKEN_PROGRAM_ID as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">,
      systemProgram: SystemProgram.programId.toString() as Address,
      networkOut,
      tokenOut,
      toAddress,
      amount,
      relayerFee,
      nonce,
    });

    const outboundTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(user, tx),
      (tx) => appendTransactionMessageInstruction(outboundIx, tx)
    );

    const signedOutboundTx =
      await signTransactionMessageWithSigners(outboundTxMessage);
    const encodedOutboundTx = getTransactionEncoder().encode(signedOutboundTx);
    const versionedOutboundTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedOutboundTx)
    );

    const res = svm.sendTransaction(versionedOutboundTx);
    const logs = (res as any).logs() as string[];

    // Find and deserialize the event data from logs
    // sol_log_data creates logs with format: "Program data: <base64>"
    const eventLog = logs.find((log) => log.startsWith("Program data:"));
    assert.ok(eventLog, "Event log should exist");

    // Extract base64 data (everything after "Program data: ")
    const base64Data = eventLog.split("Program data: ")[1];
    const eventBytes = new Uint8Array(Buffer.from(base64Data, "base64"));

    // Create decoder for OutboundOrderArgs (matches Rust struct)
    const outboundOrderArgsDecoder = getStructDecoder([
      ["networkOut", getU32Decoder()],
      ["tokenOut", fixDecoderSize(getBytesDecoder(), 32)],
      ["toAddress", fixDecoderSize(getBytesDecoder(), 32)],
      ["amount", getU64Decoder()],
      ["relayerFee", getU128Decoder()],
      ["nonce", fixDecoderSize(getBytesDecoder(), 32)],
    ]);

    const decodedEvent = outboundOrderArgsDecoder.decode(eventBytes);

    // Verify event data matches input
    assert.strictEqual(decodedEvent.networkOut, networkOut);
    assert.deepStrictEqual(
      Array.from(decodedEvent.tokenOut),
      Array.from(tokenOut)
    );
    assert.deepStrictEqual(
      Array.from(decodedEvent.toAddress),
      Array.from(toAddress)
    );
    assert.strictEqual(decodedEvent.amount, amount);
    assert.strictEqual(decodedEvent.relayerFee, relayerFee);
    assert.deepStrictEqual(Array.from(decodedEvent.nonce), Array.from(nonce));

    // Verify outbound order was created
    const outboundOrderAccount = svm.getAccount(
      new PublicKey(outboundOrderPda)
    );
    assert.ok(outboundOrderAccount, "Outbound order account should exist");

    const decodedOutboundOrder = getOutboundOrderDecoder().decode(
      outboundOrderAccount!.data
    );

    assert.strictEqual(decodedOutboundOrder.key, Key.OutboundOrder);
    assert.strictEqual(decodedOutboundOrder.networkIn, 2); // SOLANA_NETWORK_ID
    assert.strictEqual(decodedOutboundOrder.networkOut, networkOut);
    assert.deepStrictEqual(
      Array.from(decodedOutboundOrder.tokenIn),
      Array.from(tokenMintPubkey.toBytes())
    );
    assert.deepStrictEqual(
      Array.from(decodedOutboundOrder.tokenOut),
      Array.from(tokenOut)
    );
    assert.deepStrictEqual(
      Array.from(decodedOutboundOrder.fromAddress),
      Array.from(new PublicKey(user.address).toBytes())
    );
    assert.deepStrictEqual(
      Array.from(decodedOutboundOrder.toAddress),
      Array.from(toAddress)
    );
    assert.strictEqual(decodedOutboundOrder.amount, amount);
    assert.strictEqual(decodedOutboundOrder.relayerFee, relayerFee);
    assert.deepStrictEqual(
      Array.from(decodedOutboundOrder.nonce),
      Array.from(nonce)
    );
    assert.strictEqual(decodedOutboundOrder.bump, outboundBump);

    // Verify tokens were burned by checking mint supply decreased

    // Verify mint supply decreased
    const mintAccount = svm.getAccount(tokenMintPubkey);
    const decodedMint = getMintDecoder().decode(mintAccount!.data);
    assert.strictEqual(
      decodedMint.supply,
      mintAmount - amount,
      "Mint supply should decrease after burn"
    );
  });
});
