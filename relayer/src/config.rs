use alloy::primitives::{Address, U256};
use anyhow::{Context, Result};

/// Runtime configuration, all from environment variables.
#[derive(Clone, Debug)]
pub struct Config {
    pub rpc_url: String,
    pub private_key: String,
    pub pool_address: Address,
    /// Minimum fee (in the note's asset units) the relayer will accept.
    /// Defaults to 0 for the testnet gas-sponsored deployment.
    pub min_fee: U256,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let rpc_url = std::env::var("RPC_URL").context("RPC_URL is required")?;
        let private_key = std::env::var("PRIVATE_KEY").context("PRIVATE_KEY is required")?;
        let pool_address = std::env::var("POOL_ADDRESS")
            .context("POOL_ADDRESS is required")?
            .parse::<Address>()
            .context("POOL_ADDRESS is not a valid address")?;
        let min_fee = std::env::var("MIN_FEE")
            .ok()
            .map(|s| U256::from_str_radix(s.trim_start_matches("0x"), if s.starts_with("0x") { 16 } else { 10 }))
            .transpose()
            .context("MIN_FEE is not a valid integer")?
            .unwrap_or(U256::ZERO);
        // Render injects PORT; default to 8080 locally.
        let port = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8080);

        Ok(Config { rpc_url, private_key, pool_address, min_fee, port })
    }
}
