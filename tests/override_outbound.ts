import { LiteSVM } from "litesvm";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getOverrideOutboundInstruction } from "../clients/js/instructions/overrideOutbound";
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
} from "@solana/kit";
import {
  AccountState,
  getMintDecoder,
  getMintEncoder,
  getTokenEncoder,
} from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import {
  getOverrideOutboundEventDecoder,
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

describe("override outbound test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let user: KeyPairSigner;
  let tokenMint: KeyPairSigner;
  let userTokenAccount: Address;
  let globalStatePda: Address;
  let tokenMintPubkey: PublicKey;
  let mintAmount: bigint;
  let outboundOrderPda: Address;
  let outboundBump: number;
  let originalToAddress: Uint8Array;
  let originalRelayerFee: bigint;
  let nonce: Uint8Array;

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

    // Initialize global state using the init instruction
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

    const tokenAccountToSet = {
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

    const mintAccountToSet = {
      executable: false,
      owner: new PublicKey(TOKEN_PROGRAM_ID),
      lamports: LAMPORTS_PER_SOL,
      data: new Uint8Array(mintAccountDataToSet),
    };

    svm.setAccount(new PublicKey(userTokenAccount), tokenAccountToSet);
    svm.setAccount(new PublicKey(tokenMint.address), mintAccountToSet);

    // Create an outbound order first
    const networkOut = QUBIC_NETWORK_ID;
    const tokenOut = QUBIC_CONTRACT_ADDRESS;
    originalToAddress = new Uint8Array(32).fill(1);
    const amount = 500000000n;
    originalRelayerFee = 10000000n;
    nonce = new Uint8Array(32).fill(42);

    const [outboundPda, bump] = await getProgramDerivedAddress({
      programAddress: QS_BRIDGE_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("outbound_order"),
        getU32Encoder().encode(networkOut),
        getBytesEncoder().encode(nonce),
      ],
    });
    outboundOrderPda = outboundPda;
    outboundBump = bump;

    const outboundIx = getOutboundInstruction({
      user,
      globalState: globalStatePda,
      outboundOrder: outboundOrderPda,
      userTokenAccount: userTokenAccount as Address,
      tokenMint: tokenMint.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId.toString() as Address,
      networkOut,
      tokenOut,
      toAddress: originalToAddress,
      amount,
      relayerFee: originalRelayerFee,
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
    svm.sendTransaction(versionedOutboundTx);
  });

  it("should override outbound order to_address and relayer_fee", async () => {
    // Verify original order exists
    const originalOrderAccount = svm.getAccount(
      new PublicKey(outboundOrderPda)
    );
    assert.ok(originalOrderAccount, "Outbound order should exist");

    const originalOrder = getOutboundOrderDecoder().decode(
      originalOrderAccount!.data
    );
    assert.deepStrictEqual(
      Array.from(originalOrder.toAddress),
      Array.from(originalToAddress)
    );
    assert.strictEqual(originalOrder.relayerFee, originalRelayerFee);

    // Prepare override parameters
    const newToAddress = new Uint8Array(32).fill(2); // Different address
    const newRelayerFee = 20000000n; // Different fee

    // Create override instruction
    const overrideIx = getOverrideOutboundInstruction({
      caller: user,
      globalState: globalStatePda,
      outboundOrder: outboundOrderPda,
      toAddress: newToAddress,
      relayerFee: newRelayerFee,
    });

    const overrideTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(user, tx),
      (tx) => appendTransactionMessageInstruction(overrideIx, tx)
    );

    const signedOverrideTx =
      await signTransactionMessageWithSigners(overrideTxMessage);
    const encodedOverrideTx = getTransactionEncoder().encode(signedOverrideTx);
    const versionedOverrideTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedOverrideTx)
    );

    const res = svm.sendTransaction(versionedOverrideTx);
    const logs = (res as any).logs() as string[];

    // Find and deserialize the event data from logs
    const eventLog = logs.find((log) => log.startsWith("Program data:"));
    assert.ok(eventLog, "Event log should exist");

    // Extract base64 data
    const base64Data = eventLog.split("Program data: ")[1];
    const eventBytes = new Uint8Array(Buffer.from(base64Data, "base64"));

    const decodedEvent = getOverrideOutboundEventDecoder().decode(eventBytes);

    // Verify event data matches updated values
    assert.deepStrictEqual(
      Array.from(decodedEvent.toAddress),
      Array.from(newToAddress)
    );
    assert.strictEqual(decodedEvent.relayerFee, newRelayerFee);
    assert.deepStrictEqual(Array.from(decodedEvent.nonce), Array.from(nonce));

    // Verify outbound order was updated
    const updatedOrderAccount = svm.getAccount(new PublicKey(outboundOrderPda));
    const updatedOrder = getOutboundOrderDecoder().decode(
      updatedOrderAccount!.data
    );

    assert.strictEqual(updatedOrder.key, Key.OutboundOrder);
    assert.deepStrictEqual(
      Array.from(updatedOrder.toAddress),
      Array.from(newToAddress),
      "to_address should be updated"
    );
    assert.strictEqual(
      updatedOrder.relayerFee,
      newRelayerFee,
      "relayer_fee should be updated"
    );
    assert.deepStrictEqual(Array.from(updatedOrder.nonce), Array.from(nonce));

    // Verify other fields remain unchanged
    assert.strictEqual(updatedOrder.amount, originalOrder.amount);
    assert.deepStrictEqual(
      Array.from(updatedOrder.fromAddress),
      Array.from(originalOrder.fromAddress)
    );
  });

  it("should override only to_address when relayer_fee is not provided", async () => {
    // Reset to original values first
    const resetToAddress = new Uint8Array(32).fill(3);
    const resetIx = getOverrideOutboundInstruction({
      caller: user,
      globalState: globalStatePda,
      outboundOrder: outboundOrderPda,
      toAddress: resetToAddress,
      relayerFee: null,
    });

    const resetTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(user, tx),
      (tx) => appendTransactionMessageInstruction(resetIx, tx)
    );

    const signedResetTx =
      await signTransactionMessageWithSigners(resetTxMessage);
    const encodedResetTx = getTransactionEncoder().encode(signedResetTx);
    const versionedResetTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedResetTx)
    );
    svm.sendTransaction(versionedResetTx);

    // Get the relayer_fee before override
    const beforeOrderAccount = svm.getAccount(new PublicKey(outboundOrderPda));
    const beforeOrder = getOutboundOrderDecoder().decode(
      beforeOrderAccount!.data
    );
    const beforeRelayerFee = beforeOrder.relayerFee;

    // Override only to_address
    const newToAddressOnly = new Uint8Array(32).fill(4);
    const overrideOnlyToAddressIx = getOverrideOutboundInstruction({
      caller: user,
      globalState: globalStatePda,
      outboundOrder: outboundOrderPda,
      toAddress: newToAddressOnly,
      relayerFee: null,
    });

    const overrideOnlyToAddressTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(user, tx),
      (tx) => appendTransactionMessageInstruction(overrideOnlyToAddressIx, tx)
    );

    const signedOverrideOnlyToAddressTx =
      await signTransactionMessageWithSigners(overrideOnlyToAddressTxMessage);
    const encodedOverrideOnlyToAddressTx = getTransactionEncoder().encode(
      signedOverrideOnlyToAddressTx
    );
    const versionedOverrideOnlyToAddressTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedOverrideOnlyToAddressTx)
    );
    svm.sendTransaction(versionedOverrideOnlyToAddressTx);

    // Verify only to_address was updated
    const afterOrderAccount = svm.getAccount(new PublicKey(outboundOrderPda));
    const afterOrder = getOutboundOrderDecoder().decode(
      afterOrderAccount!.data
    );

    assert.deepStrictEqual(
      Array.from(afterOrder.toAddress),
      Array.from(newToAddressOnly),
      "to_address should be updated"
    );
    assert.strictEqual(
      afterOrder.relayerFee,
      beforeRelayerFee,
      "relayer_fee should remain unchanged"
    );
  });
});
