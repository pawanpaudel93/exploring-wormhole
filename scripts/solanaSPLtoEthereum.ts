import {
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
    CHAIN_ID_ETH,
    getSignedVAAWithRetry,
    tryNativeToUint8Array,
    CHAIN_ID_SOLANA,
    setDefaultWasm,
    attestFromSolana,
    parseSequenceFromLogSolana,
    getEmitterAddressSolana,
    createWrappedOnEth,
    getForeignAssetEth,
    transferFromSolana,
    redeemOnEth,
} from "@certusone/wormhole-sdk";

import base58 from "bs58";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import hre, { ethers } from "hardhat";
import { formatUnits } from "ethers/lib/utils";
import { BigNumber, Contract, Signer } from "ethers";

setDefaultWasm("node"); // needed while in node environment

// Token bridge address solana and eth (Goerli)
const SOLANA_TOKEN_BRIDGE_ADDRESS =
    "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe";
const ETH_TOKEN_BRIDGE_ADDRESS = "0xF890982f9310df57d00f659cf4fd87e65adEd8d7";

// Core bridge address solana and eth (Goerli)
const SOLANA_CORE_BRIDGE_ADDRESS =
    "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
const ETH_CORE_BRIDGE_ADDRESS = "0x706abc4E45D419950511e474C7B9Ed348A4a716c";

// Token address
const SPL_TOKEN_ADDRESS = "3SaRFBUpc8WcTMDWPHzceHBHsPkwEi4cBakUVMWzQG7G"

const WORMHOLE_RPC_HOSTS = ["https://wormhole-v2-testnet-api.certus.one"];

const SOLANA_RPC = clusterApiUrl("devnet");

async function displayBalance(token: Contract, signer: Signer, DECIMALS: BigNumber, connection: Connection, keypair: Keypair, mintAccount: string) {
    let initialSolanaBalance = 0;
    const results = await connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        {
            programId: TOKEN_PROGRAM_ID
        }
    )
    for (const item of results.value) {
        const tokenInfo = item.account.data.parsed.info;
        const address = tokenInfo.mint;
        const amount = tokenInfo.tokenAmount.uiAmount;
        if (address === mintAccount) {
            initialSolanaBalance = amount;
        }
    }
    console.log("SPL token balance:", initialSolanaBalance);

    const initialERC20Balance = await token.balanceOf(await signer.getAddress())
    const initialERC20Formatted = formatUnits(
        initialERC20Balance,
        DECIMALS
    )
    console.log("Wrapped ERC20 balance:", initialERC20Formatted);
}

/**
 * Attest the SPL token to the wormhole network
 */
async function attest() {
    console.log("Attesting Solana SPL token...");
    // create a keypair for Solana
    const keypair = Keypair.fromSecretKey(
        base58.decode(process.env.SOLANA_PRIVATE_KEY as string)
    );
    const payerAddress = keypair.publicKey.toString();

    const connection = new Connection(SOLANA_RPC, "confirmed");
    const transaction = await attestFromSolana(
        connection,
        SOLANA_CORE_BRIDGE_ADDRESS,
        SOLANA_TOKEN_BRIDGE_ADDRESS,
        payerAddress,
        SPL_TOKEN_ADDRESS
    );
    // sign, send and confirm the transaction
    transaction.partialSign(keypair);
    const txId = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(txId);
    const info = await connection.getTransaction(txId);
    if (!info) {
        throw new Error("Error occurred while fetching the transaction info");
    }
    // Get the sequence number and emitter address to fetch the singedVAA of our message
    const sequence = parseSequenceFromLogSolana(info);
    const emitterAddress = await getEmitterAddressSolana(SOLANA_TOKEN_BRIDGE_ADDRESS);
    console.log("Fetching signedVAA from Guardian Network...");
    // Fetch the signedVAA from the WormHole Network (Guardian)
    const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
        WORMHOLE_RPC_HOSTS,
        CHAIN_ID_SOLANA,
        emitterAddress,
        sequence,
        {
            transport: NodeHttpTransport(),
        }
    );

    const signer = (await hre.ethers.getSigners())[0];
    console.log("Creating wrapped token on ethereum...");
    // Finally, create wormhole wrapped token (mint and metadata) on ethereum
    try {
        await createWrappedOnEth(
            ETH_TOKEN_BRIDGE_ADDRESS,
            signer,
            signedVAA,
        );
    } catch (e) {
        console.log(e);
    }
    console.log("Attest complete! 🎉");
}

/**
 * Transfer the Solana SPL to the Ethereum token
 */
async function transfer() {
    console.log("Transferring SPL token to Ethereum...");
    const signer = (await hre.ethers.getSigners())[0];
    const targetAddress = await signer.getAddress();
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const keypair = Keypair.fromSecretKey(
        base58.decode(process.env.SOLANA_PRIVATE_KEY as string)
    );
    const payerAddress = keypair.publicKey.toString();
    const fromAddress = (await getAssociatedTokenAddress(
        new PublicKey(SPL_TOKEN_ADDRESS),
        keypair.publicKey,
    )).toString()
    const foreignAsset = await getForeignAssetEth(
        ETH_TOKEN_BRIDGE_ADDRESS,
        signer,
        CHAIN_ID_SOLANA,
        tryNativeToUint8Array(SPL_TOKEN_ADDRESS, CHAIN_ID_SOLANA),
    )
    if (!foreignAsset) {
        throw new Error("Foreign asset not found");
    }
    const RowdyToken = await ethers.getContractFactory("RowdyToken");
    const erc20Token = new Contract(
        foreignAsset,
        RowdyToken.interface,
        signer
    )
    console.log("Initial Balance: ")

    displayBalance(erc20Token, signer, BigNumber.from(0), connection, keypair, SPL_TOKEN_ADDRESS);

    const amount = BigInt(1);
    const transaction = await transferFromSolana(
        connection,
        SOLANA_CORE_BRIDGE_ADDRESS,
        SOLANA_TOKEN_BRIDGE_ADDRESS,
        payerAddress,
        fromAddress,
        SPL_TOKEN_ADDRESS,
        amount,
        tryNativeToUint8Array(targetAddress, CHAIN_ID_ETH),
        CHAIN_ID_ETH,
    )
    // sign, send and confirm the transaction
    transaction.partialSign(keypair);
    const txId = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(txId);
    const info = await connection.getTransaction(txId);
    if (!info) {
        throw new Error("Error occurred while fetching the transaction info");
    }
    const sequence = parseSequenceFromLogSolana(info);
    const emitterAddress = await getEmitterAddressSolana(SOLANA_TOKEN_BRIDGE_ADDRESS);
    const { vaaBytes: signedVAA } = await getSignedVAAWithRetry(
        WORMHOLE_RPC_HOSTS,
        CHAIN_ID_SOLANA,
        emitterAddress,
        sequence,
        {
            transport: NodeHttpTransport(),
        }
    );
    await redeemOnEth(
        ETH_TOKEN_BRIDGE_ADDRESS,
        signer,
        signedVAA,
    )
    console.log("Final Balance: ")
    displayBalance(erc20Token, signer, BigNumber.from(0), connection, keypair, SPL_TOKEN_ADDRESS);
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
