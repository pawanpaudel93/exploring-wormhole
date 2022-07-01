import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import {
  getForeignAssetSolana,
  CHAIN_ID_ETH,
  attestFromEth,
  parseSequenceFromLogEth,
  getEmitterAddressEth,
  postVaaSolana,
  getSignedVAAWithRetry,
  createWrappedOnSolana,
  tryNativeToUint8Array,
  approveEth,
  transferFromEth,
  CHAIN_ID_SOLANA,
  redeemOnSolana,
  setDefaultWasm,
} from "@certusone/wormhole-sdk";

import base58 from "bs58";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import hre, { ethers } from "hardhat";

setDefaultWasm("node"); // needed while in node environment

// Token bridge address solana and eth (Goerli)
const SOLANA_TOKEN_BRIDGE_ADDRESS =
  "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe";
const ETH_TOKEN_BRIDGE_ADDRESS = "0xF890982f9310df57d00f659cf4fd87e65adEd8d7";

// Core bridge address solana and eth (Goerli)
const SOLANA_CORE_BRIDGE_ADDRESS =
  "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
const ETH_CORE_BRIDGE_ADDRESS = "0x706abc4E45D419950511e474C7B9Ed348A4a716c";

// Token address on eth (Goerli)
const ETH_TOKEN_ADDRESS = "0x604b799687e94D6CE7b3C8D1a6575bF05cA608ef";

const WORMHOLE_RPC_HOSTS = ["https://wormhole-v2-testnet-api.certus.one"];

const SOLANA_RPC = clusterApiUrl("devnet");

/**
 * Attest the ERC token to the WormHole Network
 */
async function attest() {
  console.log("Attesting ERC token...");
  const signer = (await hre.ethers.getSigners())[0];
  const receipt = await attestFromEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    signer,
    ETH_TOKEN_ADDRESS
  );
  // Get the sequence number and emitter address to fetch the singedVAA of our message
  const sequence = parseSequenceFromLogEth(receipt, ETH_CORE_BRIDGE_ADDRESS);
  const emitterAddress = getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS);
  console.log("Fetching signedVAA from Guardian Network...");
  // Fetch the signedVAA from the WormHole Network (Guardian)
  const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
    WORMHOLE_RPC_HOSTS,
    CHAIN_ID_ETH,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );

  // create a keypair for Solana
  const keypair = Keypair.fromSecretKey(
    base58.decode(process.env.SOLANA_PRIVATE_KEY as string)
  );
  const payerAddress = keypair.publicKey.toString();
  console.log("Posting signedVAA to Solana...");
  // On Solana, we have to post the signedVAA ourselves
  const connection = new Connection(SOLANA_RPC, "confirmed");
  await postVaaSolana(
    connection,
    async (transaction) => {
      transaction.partialSign(keypair);
      return transaction;
    },
    SOLANA_CORE_BRIDGE_ADDRESS,
    payerAddress,
    Buffer.from(signedVAA)
  );
  console.log("Creating wrapped token on solana...");
  // Finally, create wormhole wrapped token (mint and metadata) on solana
  const transaction = await createWrappedOnSolana(
    connection,
    SOLANA_CORE_BRIDGE_ADDRESS,
    SOLANA_TOKEN_BRIDGE_ADDRESS,
    payerAddress,
    signedVAA
  );
  // sign, send and confirm the transaction
  try {
    transaction.partialSign(keypair);
    const txId = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(txId);
  } catch (e) {
    console.error(e);
  }
  console.log("Attest complete! 🎉");
}

/**
 * Transfer the ERC token to Solana
 */
async function transfer() {
  console.log("Transferring ERC token to Solana...");
  const rowdyContract = await ethers.getContract("RowdyToken");
  const DECIMALS = await rowdyContract.decimals();
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const keypair = Keypair.fromSecretKey(
    base58.decode(process.env.SOLANA_PRIVATE_KEY as string)
  );
  const payerAddress = keypair.publicKey.toString();
  const solanaMintKey = new PublicKey(
    (await getForeignAssetSolana(
      connection,
      SOLANA_TOKEN_BRIDGE_ADDRESS,
      CHAIN_ID_ETH,
      tryNativeToUint8Array(ETH_TOKEN_ADDRESS, CHAIN_ID_ETH)
    )) || ""
  );
  const recipient = await getAssociatedTokenAddress(
    solanaMintKey,
    keypair.publicKey
  );
  console.log("Creating associated token account if not exists...");
  // Create the associated token account if it doesn't exist
  await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    solanaMintKey,
    keypair.publicKey
  );
  const signer = (await ethers.getSigners())[0];
  const transferAmount = ethers.utils.parseUnits("1", DECIMALS);
  console.log("Approve the bridge to spend the tokens...");
  // approve the bridge to spend Rowdy Tokens
  await approveEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    ETH_TOKEN_ADDRESS,
    signer,
    transferAmount
  );
  console.log("Transferring the tokens...");
  // transfer tokens
  const receipt = await transferFromEth(
    ETH_TOKEN_BRIDGE_ADDRESS,
    signer,
    ETH_TOKEN_ADDRESS,
    transferAmount,
    CHAIN_ID_SOLANA,
    tryNativeToUint8Array(recipient.toString(), CHAIN_ID_SOLANA)
  );
  const sequence = parseSequenceFromLogEth(receipt, ETH_CORE_BRIDGE_ADDRESS);
  const emitterAddress = getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS);
  console.log("Fetching signedVAA from Guardian Network...");
  // poll guardian until the guardians signs the VAA
  const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
    WORMHOLE_RPC_HOSTS,
    CHAIN_ID_ETH,
    emitterAddress,
    sequence,
    {
      transport: NodeHttpTransport(),
    }
  );
  console.log("Posting signedVAA to Solana...");
  // post the signedVAA to Solana
  await postVaaSolana(
    connection,
    async (transaction) => {
      transaction.partialSign(keypair);
      return transaction;
    },
    SOLANA_CORE_BRIDGE_ADDRESS,
    payerAddress,
    Buffer.from(signedVAA)
  );
  console.log("Redeeming the tokens on Solana...");
  // redeem tokens on Solana
  const transaction = await redeemOnSolana(
    connection,
    SOLANA_CORE_BRIDGE_ADDRESS,
    SOLANA_TOKEN_BRIDGE_ADDRESS,
    payerAddress,
    signedVAA
  );
  transaction.partialSign(keypair);
  const txId = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(txId);
  console.log("Transfer complete! 🎉");
}

async function main() {
  try {
    await attest();
    await transfer();
  } catch (e) {
    console.error(e);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
