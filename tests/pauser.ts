import { AccountInfoBytes, FailedTransactionMetadata, LiteSVM } from "litesvm";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import {
  getAddPauserInstruction,
  getRemovePauserInstruction,
  getPauseInstruction,
  getUnpauseInstruction,
} from "../clients/js/instructions";
import { findGlobalStatePda } from "../clients/js/pdas/globalState";
import { findPauserPda } from "../clients/js/pdas/pauser";
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
} from "@solana/kit";
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import {
  getGlobalStateDecoder,
  getPauserDecoder,
} from "../clients/js/accounts";
import { QS_BRIDGE_PROGRAM_ADDRESS } from "../clients/js/programs/qsBridge";
import assert from "assert";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;

describe("pauser test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let pauser1: KeyPairSigner;
  let pauser2: KeyPairSigner;
  let tokenMint: KeyPairSigner;
  let globalStatePda: Address;
  let tokenMintPubkey: PublicKey;

  beforeAll(async () => {
    admin = await generateKeyPairSigner();
    pauser1 = await generateKeyPairSigner();
    pauser2 = await generateKeyPairSigner();
    tokenMint = await generateKeyPairSigner();
    tokenMintPubkey = new PublicKey(tokenMint.address);

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(pauser1.address), 1000000000n);
    svm.airdrop(new PublicKey(pauser2.address), 1000000000n);

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

    // Initialize global state
    const initGlobalStateIx = getInitGlobalStateInstruction({
      admin,
      globalState: globalStatePda,
      protocolFeeRecipient: protocolFeeRecipient.address,
      tokenMint: tokenMint,
      systemProgram: SystemProgram.programId.toString() as Address,
      tokenMetadata,
      bpsFee: 100,
      protocolFeeBpsOfBps: 100,
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

    // Set up the mint account
    const mintAccount = getMintEncoder().encode({
      mintAuthority: tokenMint.address,
      supply: 1000000000n,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: tokenMint.address,
    });

    const mintAccountToSet: AccountInfoBytes = {
      lamports: LAMPORTS_PER_SOL,
      data: new Uint8Array(mintAccount),
      owner: new PublicKey(TOKEN_PROGRAM_ADDRESS),
      executable: false,
    };

    svm.setAccount(new PublicKey(tokenMint.address), mintAccountToSet);
  });

  it("should add a pauser", async () => {
    const [pauser1Pda] = await findPauserPda({ pauser: pauser1.address });
    const addPauserIx = getAddPauserInstruction({
      admin,
      globalState: globalStatePda,
      pauserPda: pauser1Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
      pauserPubkey: pauser1.address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(addPauserIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify pauser account exists and has correct data
    const pauserAccount = svm.getAccount(new PublicKey(pauser1Pda));
    assert.ok(pauserAccount, "Pauser account should exist");

    const decodedPauser = getPauserDecoder().decode(
      new Uint8Array(pauserAccount.data)
    );
    assert.strictEqual(
      decodedPauser.pauserPubkey,
      pauser1.address,
      "Pauser pubkey should match"
    );
  });

  it("should pause the program", async () => {
    const [pauser1Pda] = await findPauserPda({ pauser: pauser1.address });

    // Verify global state is not paused
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.paused,
      false,
      "Global state should not be paused initially"
    );

    const pauseIx = getPauseInstruction({
      pauser: pauser1,
      globalState: globalStatePda,
      pauserPda: pauser1Pda,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(pauser1, tx),
      (tx) => appendTransactionMessageInstruction(pauseIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify global state is now paused
    const updatedGlobalStateAccount = svm.getAccount(
      new PublicKey(globalStatePda)
    );
    assert.ok(updatedGlobalStateAccount, "Global state account should exist");
    const updatedDecodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(updatedGlobalStateAccount.data)
    );
    assert.strictEqual(
      updatedDecodedGlobalState.paused,
      true,
      "Global state should be paused"
    );
  });

  it("pauser cannot unpause", async () => {
    const unpauseIx = getUnpauseInstruction({
      admin: pauser1,
      globalState: globalStatePda,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(pauser1, tx),
      (tx) => appendTransactionMessageInstruction(unpauseIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    const result = svm.sendTransaction(versionedTx);
    assert.ok(
      result instanceof FailedTransactionMetadata,
      "Transaction should have failed"
    );

    // Bridge should still be paused
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.paused,
      true,
      "Global state should still be paused"
    );
  });

  it("admin can unpause", async () => {
    const unpauseIx = getUnpauseInstruction({
      admin,
      globalState: globalStatePda,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(unpauseIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify global state is now unpaused
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.paused,
      false,
      "Global state should be unpaused"
    );
  });

  it("should add a second pauser", async () => {
    const [pauser2Pda] = await findPauserPda({ pauser: pauser2.address });
    const addPauserIx = getAddPauserInstruction({
      admin,
      globalState: globalStatePda,
      pauserPda: pauser2Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
      pauserPubkey: pauser2.address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(addPauserIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify second pauser account exists
    const pauserAccount = svm.getAccount(new PublicKey(pauser2Pda));
    assert.ok(pauserAccount, "Second pauser account should exist");
    assert.ok(
      pauserAccount.data.length > 0,
      "Second pauser account should have data"
    );

    const decodedPauser = getPauserDecoder().decode(
      new Uint8Array(pauserAccount.data)
    );
    assert.strictEqual(
      decodedPauser.pauserPubkey,
      pauser2.address,
      "Second pauser pubkey should match"
    );
  });

  it("should remove a pauser", async () => {
    const [pauser2Pda] = await findPauserPda({ pauser: pauser2.address });

    // Verify pauser account exists before removal
    const pauserAccountBefore = svm.getAccount(new PublicKey(pauser2Pda));
    assert.ok(
      pauserAccountBefore,
      "Pauser account should exist before removal"
    );
    assert.ok(
      pauserAccountBefore.data.length > 0,
      "Pauser account should have data before removal"
    );

    const removePauserIx = getRemovePauserInstruction({
      admin,
      globalState: globalStatePda,
      pauserPda: pauser2Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(removePauserIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify pauser account is closed
    const pauserAccountAfter = svm.getAccount(new PublicKey(pauser2Pda));
    assert.strictEqual(
      pauserAccountAfter,
      null,
      "Pauser account should exist after removal"
    );
  });
});
