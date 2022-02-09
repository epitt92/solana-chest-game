import * as anchor from '@project-serum/anchor';
import { Program, web3 } from '@project-serum/anchor';
import * as splToken from '@solana/spl-token';
import assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';

import { TreasureChestProgram } from '../target/types/treasure_chest_program';

const { LAMPORTS_PER_SOL } = web3;

describe('treasure-chest-program', async () => {
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace
    .TreasureChestProgram as Program<TreasureChestProgram>;

  const initialLamports = new anchor.BN(LAMPORTS_PER_SOL);

  const connection = new web3.Connection(
    web3.clusterApiUrl('devnet'),
    'confirmed'
  );

  /** Chest id generated from keypair */
  const chestKeypair = web3.Keypair.generate();
  const chestId = chestKeypair.publicKey;
  const chestSeed = Buffer.from(chestId.toBytes().slice(0, 8));

  const [chestPda, chestBump] = await web3.PublicKey.findProgramAddress(
    [chestSeed],
    program.programId
  );

  /** Wallet that will receive the treasure transfer */
  const fakeUserWallet = web3.Keypair.generate();

  connection
    .getMinimumBalanceForRentExemption(74)
    .then((rent) => connection.requestAirdrop(fakeUserWallet.publicKey, rent));

  const userPdaSeed = [
    Buffer.from(fakeUserWallet.publicKey.toBytes()),
    Buffer.from(chestId.toBytes()),
  ];

  const [fakeUserPDA, fakeUserBump] = await web3.PublicKey.findProgramAddress(
    userPdaSeed,
    program.programId
  );

  it('should be able to create a new chest account', async () => {
    const signature = await program.rpc.initializeChest(
      {
        initialLamports,
        bump: chestBump,
        seed: Array.from(chestSeed),
      },
      {
        accounts: {
          chestAccount: chestPda,
          authority: program.provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        },
      }
    );

    console.log('chest init signature:', signature);
    console.log('chest public key:', chestId.toString());
    console.log('chest pda:', chestPda.toString());

    const initialized = await program.account.chestAccount.fetch(chestPda);

    const balance = await connection.getBalance(chestPda);

    assert.deepEqual(initialized.authority, program.provider.wallet.publicKey);
    assert.ok(new anchor.BN(balance).gte(initialLamports));
  });

  it("should initialize an user's account", async () => {
    // fakeUserWallet = web3.Keypair.fromSecretKey(secret_key);

    const signature = await program.rpc.initializeUserAccount(
      {
        bump: fakeUserBump,
        seed: userPdaSeed,
      },
      {
        accounts: {
          userAccount: fakeUserPDA,
          authority: fakeUserWallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        },
        signers: [fakeUserWallet],
      }
    );

    console.log('user account init signature:', signature);

    const initialized = await program.account.userAccount.fetch(fakeUserPDA);

    assert.deepEqual(initialized.visitedChest, false);
  });

  it.skip('should be able to transfer lamports from a chest to a wallet', async () => {
    const signature = await program.rpc.transfer(
      { lamports: new anchor.BN(LAMPORTS_PER_SOL) },
      {
        accounts: {
          from: chestPda,
          to: fakeUserPDA,
          toDepositAddress: fakeUserWallet.publicKey,
          authority: program.provider.wallet.publicKey,
        },
      }
    );

    console.log('transfer signature:', signature);

    const chestAcc = await program.account.chestAccount.fetch(chestPda);
    const chest_balance = await connection.getBalance(chestPda);
    const user_balance = await connection.getBalance(fakeUserWallet.publicKey);

    assert.ok(new anchor.BN(chest_balance).lt(initialLamports));
    assert.ok(new anchor.BN(user_balance).gte(new anchor.BN(LAMPORTS_PER_SOL)));
    assert.deepEqual(chestAcc.authority, program.provider.wallet.publicKey);
  });

  it('should be able to transfer tokens from a chest to a wallet', async () => {
    const mintAuthority = web3.Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(
          readFileSync(path.resolve('../.config/solana/anchor.json'), 'utf-8')
        )
      )
    );

    // Create a new token
    const mint = await splToken.Token.createMint(
      connection,
      mintAuthority,
      mintAuthority.publicKey,
      mintAuthority.publicKey,
      8,
      splToken.TOKEN_PROGRAM_ID
    );

    // Create chest associated token account
    const chestAssociatedAccount = await mint.getOrCreateAssociatedAccountInfo(
      chestId
    );

    // Mint 1 token to the chest.
    await mint.mintTo(
      chestAssociatedAccount.address,
      mintAuthority.publicKey,
      [],
      1e8
    );

    const toAssociatedAccount = await mint.getOrCreateAssociatedAccountInfo(
      fakeUserWallet.publicKey
    );

    const tx = await program.rpc.transferToken(new anchor.BN(1e8), {
      accounts: {
        mint: mint.publicKey,
        chestAssociatedAccount: chestAssociatedAccount.address,
        user: fakeUserPDA,
        userAssociatedAccount: toAssociatedAccount.address,
        authority: chestId,
        tokenProgram: splToken.TOKEN_PROGRAM_ID,
      },
      signers: [chestKeypair],
    });

    console.log('transfer token signature:', tx);

    const chestBalance = await connection.getTokenAccountBalance(
      chestAssociatedAccount.address
    );

    const userBalance = await connection.getTokenAccountBalance(
      toAssociatedAccount.address
    );

    console.log('chest balance:', chestBalance.value.uiAmount);
    console.log('user balance:', userBalance.value.uiAmount);

    assert.strictEqual(chestBalance.value.uiAmount, 0);
    assert.strictEqual(userBalance.value.uiAmount, 1);
  });

  it('should not be able to transfer more than once to the same wallet', async () => {
    try {
      await program.rpc.transfer(
        { lamports: new anchor.BN(1000) },
        {
          accounts: {
            from: chestPda,
            to: fakeUserPDA,
            toDepositAddress: fakeUserWallet.publicKey,
            authority: program.provider.wallet.publicKey,
          },
        }
      );

      assert.ok(false);
    } catch (err) {
      const msg = 'You have already found this treasure!';
      assert.strictEqual(err.toString(), msg);
    }
  });
});
