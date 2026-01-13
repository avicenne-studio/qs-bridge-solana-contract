import { LiteSVM } from "litesvm";
import { PublicKey, SystemProgram } from "@solana/web3.js";
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
} from "@solana/kit";
import { getMintDecoder } from "@solana-program/token";
import { VersionedTransaction } from "@solana/web3.js";
import {
  getGlobalStateDecoder,
  Key,
  QS_BRIDGE_PROGRAM_ADDRESS,
} from "../clients/js";
import assert from "assert";

const programId = new PublicKey(QS_BRIDGE_PROGRAM_ADDRESS);
const METADATA_PROGRAM_ADDRESS =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" as Address;

describe("initialize test", () => {
  const svm = new LiteSVM().withBlockhashCheck(false);
  let admin: KeyPairSigner;
  beforeAll(async () => {
    admin = await generateKeyPairSigner();
    svm.addProgramFromFile(programId, "target/deploy/qs_bridge.so");
    svm.addProgramFromFile(new PublicKey(METADATA_PROGRAM_ADDRESS), "noop.so");

    svm.airdrop(new PublicKey(admin.address), 1000000000n);
  });

  it("should initialize global state", async () => {
    const [globalStatePda, globalStateBump] = await findGlobalStatePda();
    const protocolFeeRecipient = await generateKeyPairSigner();
    const tokenMint = await generateKeyPairSigner();

    const [tokenMetadata] = await getProgramDerivedAddress({
      programAddress: METADATA_PROGRAM_ADDRESS,
      seeds: [
        getUtf8Encoder().encode("metadata"),
        getAddressEncoder().encode(METADATA_PROGRAM_ADDRESS),
        getAddressEncoder().encode(tokenMint.address),
      ],
    });

    const initIx = getInitGlobalStateInstruction({
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

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => appendTransactionMessageInstruction(initIx, tx)
    );

    const signedTransaction =
      await signTransactionMessageWithSigners(transactionMessage);
    const encodedTransaction =
      getTransactionEncoder().encode(signedTransaction);

    const mutableTransaction = new Uint8Array(encodedTransaction);
    const versionedTransaction =
      VersionedTransaction.deserialize(mutableTransaction);

    svm.sendTransaction(versionedTransaction);

    const tokenMintAccount = svm.getAccount(new PublicKey(tokenMint.address));
    const decodedTokenMintAccount = getMintDecoder().decode(
      tokenMintAccount!.data
    );

    assert.deepStrictEqual(decodedTokenMintAccount, {
      supply: 0n,
      decimals: 9,
      isInitialized: true,
      mintAuthority: { __option: "Some", value: globalStatePda },
      freezeAuthority: { __option: "Some", value: globalStatePda },
    });

    const globalStateAccount = svm.getAccount(new PublicKey(globalStatePda));

    const decodedGlobalState = getGlobalStateDecoder().decode(
      globalStateAccount!.data
    );

    assert.deepStrictEqual(decodedGlobalState, {
      key: Key.GlobalState,
      admin: admin.address,
      paused: false,
      owedProtocolFee: 0n,
      oracleCount: 0,
      bpsFee: 100,
      protocolFeeBpsOfBps: 100,
      protocolFeeRecipient: protocolFeeRecipient.address,
      tokenMint: tokenMint.address,
      bump: globalStateBump,
    });
  });
});
