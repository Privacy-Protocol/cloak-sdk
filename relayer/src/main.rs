mod config;
mod contract;
mod handlers;

use std::sync::Arc;

use alloy::network::EthereumWallet;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;

use config::Config;
use handlers::{AppState, SharedState};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cloak_relayer=info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env()?;

    let signer: PrivateKeySigner = cfg
        .private_key
        .trim_start_matches("0x")
        .parse()
        .context("PRIVATE_KEY is not a valid secp256k1 key")?;
    let relayer_address = signer.address();
    let wallet = EthereumWallet::from(signer);

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&cfg.rpc_url)
        .await
        .context("failed to connect to RPC")?
        .erased();

    let chain_id = provider.get_chain_id().await.context("failed to fetch chain id")?;

    tracing::info!(%relayer_address, pool = %cfg.pool_address, chain_id, "cloak relayer starting");

    let state: SharedState = Arc::new(AppState {
        provider,
        pool_address: cfg.pool_address,
        relayer_address,
        chain_id,
        min_fee: cfg.min_fee,
    });

    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/info", get(handlers::info))
        .route("/relay", post(handlers::relay))
        .route("/status/{id}", get(handlers::status))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", cfg.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.context("failed to bind")?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await.context("server error")?;

    Ok(())
}
