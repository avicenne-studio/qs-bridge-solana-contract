import { AccountInfoBytes, LiteSVM } from "litesvm";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getInitGlobalStateInstruction } from "../clients/js/instructions/initGlobalState";
import {
  getAddOracleInstruction,
  getRemoveOracleInstruction,
} from "../clients/js/instructions";
import { findGlobalStatePda } from "../clients/js/pdas/globalState";
import { findOraclePda } from "../clients/js/pdas/oracle";
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
  getOracleDecoder,
} from "../clients/js/accounts";
import { QS_BRIDGE_PROGRAM_ADDRESS } from "../clients/js/programs/qsBridge";
import assert from "assert";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;

describe("oracle test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  let oracle1: KeyPairSigner;
  let oracle2: KeyPairSigner;
  let tokenMint: KeyPairSigner;
  let globalStatePda: Address;

  beforeAll(async () => {
    admin = await generateKeyPairSigner();
    oracle1 = await generateKeyPairSigner();
    oracle2 = await generateKeyPairSigner();
    tokenMint = await generateKeyPairSigner();

    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
    svm.airdrop(new PublicKey(oracle1.address), 1000000000n);
    svm.airdrop(new PublicKey(oracle2.address), 1000000000n);

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

  it("should add an oracle", async () => {
    const [oracle1Pda] = await findOraclePda({ oracle: oracle1.address });
    const addOracleIx = getAddOracleInstruction({
      admin,
      globalState: globalStatePda,
      oraclePda: oracle1Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
      oraclePubkey: oracle1.address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(addOracleIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify oracle account exists and has correct data
    const oracleAccount = svm.getAccount(new PublicKey(oracle1Pda));
    assert.ok(oracleAccount, "Oracle account should exist");

    const decodedOracle = getOracleDecoder().decode(
      new Uint8Array(oracleAccount.data)
    );
    assert.strictEqual(
      decodedOracle.oraclePubkey,
      oracle1.address,
      "Oracle pubkey should match"
    );

    // Verify oracle_count was incremented in global state
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.oracleCount,
      1,
      "Oracle count should be 1 after adding first oracle"
    );
  });

  it("should add a second oracle", async () => {
    const [oracle2Pda] = await findOraclePda({ oracle: oracle2.address });
    const addOracleIx = getAddOracleInstruction({
      admin,
      globalState: globalStatePda,
      oraclePda: oracle2Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
      oraclePubkey: oracle2.address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(addOracleIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify second oracle account exists
    const oracleAccount = svm.getAccount(new PublicKey(oracle2Pda));
    assert.ok(oracleAccount, "Second oracle account should exist");

    const decodedOracle = getOracleDecoder().decode(
      new Uint8Array(oracleAccount.data)
    );
    assert.strictEqual(
      decodedOracle.oraclePubkey,
      oracle2.address,
      "Second oracle pubkey should match"
    );

    // Verify oracle_count was incremented
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.oracleCount,
      2,
      "Oracle count should be 2 after adding second oracle"
    );
  });

  it("should remove an oracle", async () => {
    const [oracle2Pda] = await findOraclePda({ oracle: oracle2.address });

    // Verify oracle account exists before removal
    const oracleAccountBefore = svm.getAccount(new PublicKey(oracle2Pda));
    assert.ok(
      oracleAccountBefore,
      "Oracle account should exist before removal"
    );

    const removeOracleIx = getRemoveOracleInstruction({
      admin,
      globalState: globalStatePda,
      oraclePda: oracle2Pda,
      systemProgram: SystemProgram.programId.toString() as Address,
    });

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(removeOracleIx, tx)
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const encodedTx = getTransactionEncoder().encode(signedTx);
    const versionedTx = VersionedTransaction.deserialize(
      new Uint8Array(encodedTx)
    );
    svm.sendTransaction(versionedTx);

    // Verify oracle account is closed
    const oracleAccountAfter = svm.getAccount(new PublicKey(oracle2Pda));
    assert.strictEqual(
      oracleAccountAfter,
      null,
      "Oracle account should be closed after removal"
    );

    // Verify oracle_count was decremented
    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));
    assert.ok(globalStateAccount, "Global state account should exist");
    const decodedGlobalState = getGlobalStateDecoder().decode(
      new Uint8Array(globalStateAccount.data)
    );
    assert.strictEqual(
      decodedGlobalState.oracleCount,
      1,
      "Oracle count should be 1 after removing one oracle"
    );
  });
});
