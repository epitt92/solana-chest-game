import * as anchor from '@project-serum/anchor';
import { Program, web3 } from '@project-serum/anchor';
require('dotenv').config();

const { LAMPORTS_PER_SOL } = web3;

export const getVariables = async () => {
  const endpoint =
    process.env.CONNECTION_NETWORK === 'devnet'
      ? process.env.SOLANA_RPC_HOST_DEVNET
      : process.env.SOLANA_RPC_HOST_MAINNET_BETA;

  if (!endpoint) throw new Error('No RPC endpoint configured.');

  if (!process.env.TREASURE_WALLET_PRIVATE_KEY)
    throw 'Treasure wallet not set up. Please report this to administrators.';

  const authority = web3.Keypair.fromSecretKey(
    new Uint8Array(
      process.env.TREASURE_WALLET_PRIVATE_KEY.split(',').map(Number)
    )
  );

  const solConnection = new web3.Connection(endpoint, 'confirmed');

  const anchorWallet = {
    publicKey: authority.publicKey,
    signAllTransactions: () => true,
    signTransaction: () => true,
  } as any;

  const provider = new anchor.Provider(solConnection, anchorWallet, {
    preflightCommitment: 'recent',
  });

  const programId = new web3.PublicKey(process.env.CHEST_PROGRAM_ID);

  const idl = await Program.fetchIdl(programId, provider);

  if (!idl)
    throw new Error(
      'No idl with address ' +
        programId.toString() +
        ' has been found on ' +
        process.env.CONNECTION_NETWORK +
        '.'
    );

  const anchorProgram = new Program(idl, programId, provider);

  const initialLamports = new anchor.BN(LAMPORTS_PER_SOL * 5);

  /** Chest id generated from keypair */
  const chestId = web3.Keypair.generate().publicKey;
  const chestSeed = Buffer.from(chestId.toBytes().slice(0, 8));

  const [chestPda, chestBump] = await web3.PublicKey.findProgramAddress(
    [chestSeed],
    anchorProgram.programId
  );

  /** Wallet that will receive the treasure transfer */

  return {
    authority,
    chestPda,
    chestBump,
    chestSeed,
    anchorProgram,
    initialLamports,
  };
};

export const initializeChest = async ({
  chestBump,
  chestPda,
  anchorProgram,
  chestSeed,
  initialLamports,
  authority,
}) => {
  const signature = await anchorProgram.rpc.initializeChest(
    {
      initialLamports: initialLamports,
      bump: chestBump,
      seed: Array.from(chestSeed),
    },
    {
      accounts: {
        chestAccount: chestPda,
        authority: authority.publicKey,
        systemProgram: web3.SystemProgram.programId,
      },
      signers: [authority],
    }
  );

  console.log('chest init signature:', signature);
  console.log('chest public key:', chestPda.toString());

  return signature;
};

(async () => {
  const {
    authority,
    chestBump,
    chestPda,
    anchorProgram,
    chestSeed,
    initialLamports,
  } = await getVariables();

  await initializeChest({
    chestBump,
    chestPda,
    anchorProgram,
    chestSeed,
    initialLamports,
    authority,
  });
})();
