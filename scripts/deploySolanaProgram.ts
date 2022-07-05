import { createAssociatedTokenAccount, createMint, getAccount, mintToChecked } from "@solana/spl-token";
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import base58 from "bs58";

async function main() {
    const connection = new Connection(clusterApiUrl("devnet"))

    const keyPair = Keypair.fromSecretKey(base58.decode(process.env.SOLANA_PRIVATE_KEY as string))

    console.log("Creating token...")
    const mintAddress = await createMint(
        connection,
        keyPair,
        keyPair.publicKey,
        keyPair.publicKey,
        0 // decimals(0 = whole numbers)
    )
    console.log("Token created:", mintAddress.toString())

    console.log("Creating token account...")
    const tokenAccount = await createAssociatedTokenAccount(
        connection,
        keyPair,
        mintAddress,
        keyPair.publicKey
    )

    console.log("Token account created:", tokenAccount.toString())

    console.log("Minting 1 million tokens...")

    await mintToChecked(
        connection,
        keyPair,
        mintAddress,
        tokenAccount,
        keyPair,
        1_000_000,
        0
    )

    console.log("Minted 1 million tokens...")

    const { amount } = await getAccount(connection, tokenAccount)
    console.log({
        tokenAddress: mintAddress.toString(),
        balance: amount.toLocaleString()
    })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});