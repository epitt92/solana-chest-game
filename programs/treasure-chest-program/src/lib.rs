#![deny(unsafe_code)]
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

declare_id!("6uNxBGP4vdnzzv8YxeubEwFmjCun5qccA2kDyPJLGTuu");

#[program]
pub mod treasure_chest_program {
    use super::*;

    use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

    pub fn initialize_chest(
        ctx: Context<InitializeChest>,
        dto: InitializeChestDTO,
    ) -> ProgramResult {
        let InitializeChestDTO {
            bump,
            seed,
            initial_lamports,
        } = dto;
        let chest = &mut ctx.accounts.chest_account;
        let authority = &ctx.accounts.authority;

        invoke_signed(
            &system_instruction::transfer(authority.key, &chest.key(), initial_lamports),
            &[
                authority.to_account_info(),
                chest.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[&seed, &[bump]]],
        )?;

        chest.bump = bump;
        chest.seed = seed;
        chest.authority = *authority.key;

        Ok(())
    }

    pub fn initialize_user_account(
        ctx: Context<InitializeUserAccount>,
        dto: InitializeUserAccountDTO,
    ) -> ProgramResult {
        let user_account = &mut ctx.accounts.user_account;
        user_account.bump = dto.bump;
        user_account.seed = dto.seed;
        user_account.visited_chest = false;
        Ok(())
    }

    pub fn transfer(ctx: Context<Transfer>, dto: TransferDTO) -> ProgramResult {
        let user = &mut ctx.accounts.to;
        let chest_info = &ctx.accounts.from.to_account_info();
        let deposit_account = &ctx.accounts.to_deposit_address;

        **chest_info.try_borrow_mut_lamports()? = chest_info
            .lamports()
            .checked_sub(dto.lamports)
            .ok_or(ProgramError::InsufficientFunds)?;

        **deposit_account.try_borrow_mut_lamports()? = deposit_account
            .lamports()
            .checked_add(dto.lamports)
            .ok_or(ProgramError::InvalidArgument)?;

        user.visited_chest = true;

        Ok(())
    }

    pub fn transfer_token(ctx: Context<TransferToken>, amount: u64) -> ProgramResult {
        let user = &mut ctx.accounts.user;
        let user_associated_account = &mut ctx.accounts.user_associated_account;
        let chest_associated_account = &mut ctx.accounts.chest_associated_account;

        let cpi_accounts = anchor_spl::token::Transfer {
            from: chest_associated_account.to_account_info(),
            to: user_associated_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };

        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        anchor_spl::token::transfer(cpi_context, amount)?;

        user.visited_chest = true;

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TransferDTO {
    pub lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeChestDTO {
    pub bump: u8,
    pub seed: [u8; 8],
    pub initial_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeUserAccountDTO {
    pub bump: u8,
    pub seed: [[u8; 32]; 2],
}

#[derive(Accounts)]
#[instruction(dto: InitializeChestDTO)]
pub struct InitializeChest<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [&dto.seed],
        bump = dto.bump,
        space = 49
    )]
    chest_account: Account<'info, ChestAccount>,
    authority: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(dto: InitializeUserAccountDTO)]
pub struct InitializeUserAccount<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [&dto.seed[0], &dto.seed[1]],
        bump = dto.bump,
        space = 8 + 66
    )]
    user_account: Account<'info, UserAccount>,
    #[account(mut)]
    authority: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(dto: TransferDTO)]
pub struct Transfer<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [&from.seed],
        bump = from.bump
    )]
    from: Account<'info, ChestAccount>,
    #[account(
        mut,
        seeds = [&to.seed[0], &to.seed[1]],
        bump = to.bump,
        constraint = !to.visited_chest @ ErrorType::AlreadyFound
    )]
    to: Account<'info, UserAccount>,
    #[account(mut)]
    to_deposit_address: AccountInfo<'info>,
    authority: Signer<'info>,
}

// TransferToken struct
#[derive(Accounts)]
pub struct TransferToken<'info> {
    mint: AccountInfo<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = authority)]
    chest_associated_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [&user.seed[0], &user.seed[1]],
        bump = user.bump,
        constraint = !user.visited_chest @ ErrorType::AlreadyFound
    )]
    user: Account<'info, UserAccount>,
    #[account(mut)]
    user_associated_account: Account<'info, TokenAccount>,
    #[account(mut)]
    authority: Signer<'info>,
    token_program: Program<'info, Token>,
}

#[account]
pub struct ChestAccount {
    bump: u8,
    seed: [u8; 8],
    authority: Pubkey,
}

#[account]
pub struct UserAccount {
    pub bump: u8,
    pub seed: [[u8; 32]; 2],
    pub visited_chest: bool,
}

#[error]
pub enum ErrorType {
    #[msg("Invalid transfer amount.")]
    InvalidTransferAmount,
    #[msg("You have already found this treasure!")]
    AlreadyFound,
}
