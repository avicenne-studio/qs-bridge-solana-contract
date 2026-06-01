use crate::traits::PdaSeeds;
use borsh::BorshDeserialize;
use solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

pub fn deserialize_and_validate_pda<T: BorshDeserialize + PdaSeeds>(
    program_id: &Pubkey,
    account: &AccountInfo,
) -> Result<T, ProgramError> {
    let data = account.try_borrow_data()?;
    let obj = T::deserialize(&mut data.as_ref()).map_err(|_| ProgramError::InvalidAccountData)?;

    let (parts, bump) = obj.pda_seeds();
    let bump_arr = [bump];

    let mut seeds: Vec<&[u8]> = parts.iter().map(|v| v.as_slice()).collect();
    seeds.push(&bump_arr);

    let expected = Pubkey::create_program_address(&seeds, program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;

    if expected != *account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    Ok(obj)
}
