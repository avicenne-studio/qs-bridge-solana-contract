import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import {
  getTransferAdminInstruction,
  getAcceptAdminInstruction,
} from "../clients/js/instructions";
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
  isSome,
} from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import { getGlobalStateDecoder } from "../clients/js/accounts";
import { QS_BRIDGE_PROGRAM_ADDRESS } from "../clients/js/programs/qsBridge";
import assert from "assert";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;

describe("transfer admin test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let newAdmin: KeyPairSigner;
  let stranger: KeyPairSigner;
  let tokenMint: KeyPairSigner;
  let globalStatePda: Address;

  beforeAll(async () => {
    admin = await generateKeyPairSigner();
    newAdmin = await generateKeyPairSigner();
    stranger = await generateKeyPairSigner();
    tokenMint = await generateKeyPairSigner();

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(newAdmin.address), 1000000000n);
    svm.airdrop(new PublicKey(stranger.address), 1000000000n);

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
      tokenMint,
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
    svm.sendTransaction(VersionedTransaction.deserialize(new Uint8Array(encodedTx)));
  });

  function decodeGlobalState() {
    const account = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(account, "Global state account should exist");
    return getGlobalStateDecoder().decode(new Uint8Array(account.data));
  }

  it("non-admin cannot propose a transfer", async () => {
    const ix = getTransferAdminInstruction({
      admin: stranger,
      globalState: globalStatePda,
      newAdmin: newAdmin.address,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(stranger, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const result = svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(encodedTx))
    );

    assert.ok(result instanceof FailedTransactionMetadata, "Should have failed");
    assert.ok(!isSome(decodeGlobalState().pendingAdmin), "pendingAdmin should still be None");
  });

  it("admin can propose a transfer", async () => {
    const ix = getTransferAdminInstruction({
      admin,
      globalState: globalStatePda,
      newAdmin: newAdmin.address,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    svm.sendTransaction(VersionedTransaction.deserialize(new Uint8Array(encodedTx)));

    const state = decodeGlobalState();
    assert.ok(isSome(state.pendingAdmin), "pendingAdmin should be set");
    assert.strictEqual(state.pendingAdmin.value, newAdmin.address, "pendingAdmin should be newAdmin");
    assert.strictEqual(state.admin, admin.address, "admin should not have changed yet");
  });

  it("stranger cannot accept the transfer", async () => {
    const ix = getAcceptAdminInstruction({
      pendingAdmin: stranger,
      globalState: globalStatePda,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(stranger, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const result = svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(encodedTx))
    );

    assert.ok(result instanceof FailedTransactionMetadata, "Should have failed");
    assert.strictEqual(decodeGlobalState().admin, admin.address, "admin should not have changed");
  });

  it("current admin cannot accept the transfer", async () => {
    const ix = getAcceptAdminInstruction({
      pendingAdmin: admin,
      globalState: globalStatePda,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const result = svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(encodedTx))
    );

    assert.ok(result instanceof FailedTransactionMetadata, "Should have failed");
    assert.strictEqual(decodeGlobalState().admin, admin.address, "admin should not have changed");
  });

  it("pending admin can accept the transfer", async () => {
    const ix = getAcceptAdminInstruction({
      pendingAdmin: newAdmin,
      globalState: globalStatePda,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(newAdmin, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    svm.sendTransaction(VersionedTransaction.deserialize(new Uint8Array(encodedTx)));

    const state = decodeGlobalState();
    assert.strictEqual(state.admin, newAdmin.address, "admin should now be newAdmin");
    assert.ok(!isSome(state.pendingAdmin), "pendingAdmin should be cleared");
  });

  it("old admin can no longer propose a transfer", async () => {
    const ix = getTransferAdminInstruction({
      admin,
      globalState: globalStatePda,
      newAdmin: stranger.address,
    });
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(ix, tx)
    );
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const result = svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(encodedTx))
    );

    assert.ok(result instanceof FailedTransactionMetadata, "Old admin should have no authority");
  });

  it("admin can cancel a pending transfer by overwriting it", async () => {
    // newAdmin proposes a transfer to stranger
    const proposeIx = getTransferAdminInstruction({
      admin: newAdmin,
      globalState: globalStatePda,
      newAdmin: stranger.address,
    });
    const proposeTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(newAdmin, tx),
      (tx) => appendTransactionMessageInstruction(proposeIx, tx)
    );
    const proposeSignedTx = await signTransactionMessageWithSigners(proposeTxMessage);
    svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(getTransactionEncoder().encode(proposeSignedTx)))
    );
    assert.ok(isSome(decodeGlobalState().pendingAdmin), "pendingAdmin should be set");

    // Cancel: newAdmin overwrites pendingAdmin with themselves (no-one else can then accept)
    const cancelIx = getTransferAdminInstruction({
      admin: newAdmin,
      globalState: globalStatePda,
      newAdmin: newAdmin.address,
    });
    const cancelTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(newAdmin, tx),
      (tx) => appendTransactionMessageInstruction(cancelIx, tx)
    );
    const cancelSignedTx = await signTransactionMessageWithSigners(cancelTxMessage);
    svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(getTransactionEncoder().encode(cancelSignedTx)))
    );

    // stranger can no longer accept
    const acceptIx = getAcceptAdminInstruction({
      pendingAdmin: stranger,
      globalState: globalStatePda,
    });
    const acceptTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(stranger, tx),
      (tx) => appendTransactionMessageInstruction(acceptIx, tx)
    );
    const acceptSignedTx = await signTransactionMessageWithSigners(acceptTxMessage);
    const result = svm.sendTransaction(
      VersionedTransaction.deserialize(new Uint8Array(getTransactionEncoder().encode(acceptSignedTx)))
    );

    assert.ok(result instanceof FailedTransactionMetadata, "Overwritten pending admin should not be able to accept");
    assert.strictEqual(decodeGlobalState().admin, newAdmin.address, "admin should still be newAdmin");
  });
});
