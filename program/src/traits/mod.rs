pub trait PdaSeeds {
    fn pda_seeds(&self) -> (Vec<Vec<u8>>, u8);
}
