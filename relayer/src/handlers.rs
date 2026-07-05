use alloy::primitives::{Address, Bytes, TxHash, B256, U256};
use alloy::providers::{DynProvider, Provider};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::contract::CloakPool;

#[derive(Clone)]
pub struct AppState {
    pub provider: DynProvider,
    pub pool_address: Address,
    pub relayer_address: Address,
    pub chain_id: u64,
    pub min_fee: U256,
}

pub type SharedState = Arc<AppState>;

// -------------------- GET /info --------------------

#[derive(Serialize)]
pub struct InfoResponse {
    pub relayer_address: String,
    pub pool_address: String,
    pub chain_id: u64,
    pub min_fee: String,
}

pub async fn info(State(st): State<SharedState>) -> impl IntoResponse {
    Json(InfoResponse {
        relayer_address: st.relayer_address.to_string(),
        pool_address: st.pool_address.to_string(),
        chain_id: st.chain_id,
        min_fee: st.min_fee.to_string(),
    })
}

pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

// -------------------- POST /relay --------------------

#[derive(Deserialize)]
pub struct IntentJson {
    pub asset: String,
    pub target: String,
    pub data: String,
    pub relayer: String,
    #[serde(rename = "claimInner")]
    pub claim_inner: String,
    #[serde(rename = "returnAsset")]
    pub return_asset: String,
}

#[derive(Deserialize)]
pub struct RelayRequest {
    pub proof: String,
    pub root: String,
    #[serde(rename = "nullifierHash")]
    pub nullifier_hash: String,
    #[serde(rename = "changeCommitment")]
    pub change_commitment: String,
    #[serde(rename = "spendValue")]
    pub spend_value: String,
    pub fee: String,
    pub intent: IntentJson,
}

#[derive(Serialize)]
pub struct RelayResponse {
    pub id: String,
    pub tx_hash: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

fn err(code: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (code, Json(ErrorResponse { error: msg.into() }))
}

/// Parse a decimal or 0x-hex integer string into U256.
fn parse_uint(s: &str) -> Result<U256, String> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix("0x") {
        U256::from_str_radix(hex, 16).map_err(|e| format!("invalid hex integer: {e}"))
    } else {
        U256::from_str_radix(s, 10).map_err(|e| format!("invalid integer: {e}"))
    }
}

fn parse_b256(s: &str) -> Result<B256, String> {
    s.parse::<B256>().map_err(|e| format!("invalid bytes32 {s}: {e}"))
}

fn parse_addr(s: &str) -> Result<Address, String> {
    s.parse::<Address>().map_err(|e| format!("invalid address {s}: {e}"))
}

fn parse_bytes(s: &str) -> Result<Bytes, String> {
    if s.is_empty() || s == "0x" {
        return Ok(Bytes::new());
    }
    s.parse::<Bytes>().map_err(|e| format!("invalid bytes {s}: {e}"))
}

pub async fn relay(
    State(st): State<SharedState>,
    Json(req): Json<RelayRequest>,
) -> Result<Json<RelayResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Parse inputs.
    let proof = parse_bytes(&req.proof).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let root = parse_b256(&req.root).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let nullifier_hash = parse_b256(&req.nullifier_hash).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let change_commitment = parse_b256(&req.change_commitment).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let spend_value = parse_uint(&req.spend_value).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let fee = parse_uint(&req.fee).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;

    let intent = CloakPool::Intent {
        asset: parse_addr(&req.intent.asset).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
        target: parse_addr(&req.intent.target).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
        data: parse_bytes(&req.intent.data).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
        relayer: parse_addr(&req.intent.relayer).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
        claimInner: parse_b256(&req.intent.claim_inner).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
        returnAsset: parse_addr(&req.intent.return_asset).map_err(|e| err(StatusCode::BAD_REQUEST, e))?,
    };

    // Policy checks: fee is paid to us, and meets our minimum.
    if intent.relayer != st.relayer_address {
        return Err(err(
            StatusCode::BAD_REQUEST,
            format!("intent.relayer must be this relayer ({})", st.relayer_address),
        ));
    }
    if fee < st.min_fee {
        return Err(err(StatusCode::BAD_REQUEST, format!("fee below minimum {}", st.min_fee)));
    }

    // Fail fast on obviously-doomed submissions so callers get a clear error.
    let pool = CloakPool::new(st.pool_address, st.provider.clone());
    match pool.nullifierUsed(nullifier_hash).call().await {
        Ok(true) => return Err(err(StatusCode::CONFLICT, "nullifier already spent")),
        Ok(false) => {}
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("rpc error: {e}"))),
    }
    match pool.isKnownRoot(root).call().await {
        Ok(true) => {}
        Ok(false) => return Err(err(StatusCode::BAD_REQUEST, "root is not known to the pool")),
        Err(e) => return Err(err(StatusCode::BAD_GATEWAY, format!("rpc error: {e}"))),
    }

    let sp = CloakPool::SpendProof {
        proof,
        root,
        nullifierHash: nullifier_hash,
        changeCommitment: change_commitment,
        spendValue: spend_value,
        fee,
    };

    // Submit. Gas estimation happens during fill; a would-be revert surfaces here.
    let pending = pool
        .spend(sp, intent)
        .send()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, format!("submission failed: {e}")))?;

    let tx_hash = *pending.tx_hash();
    tracing::info!(%tx_hash, "relayed spend");

    Ok(Json(RelayResponse {
        id: tx_hash.to_string(),
        tx_hash: tx_hash.to_string(),
        status: "pending".to_string(),
    }))
}

// -------------------- GET /status/:id --------------------

#[derive(Serialize)]
pub struct StatusResponse {
    pub tx_hash: String,
    pub status: String,
    pub block_number: Option<u64>,
}

pub async fn status(
    State(st): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<StatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let hash: TxHash = id.parse().map_err(|_| err(StatusCode::BAD_REQUEST, "invalid tx hash"))?;

    match st.provider.get_transaction_receipt(hash).await {
        Ok(Some(receipt)) => Ok(Json(StatusResponse {
            tx_hash: hash.to_string(),
            status: if receipt.status() { "success".into() } else { "failed".into() },
            block_number: receipt.block_number,
        })),
        Ok(None) => Ok(Json(StatusResponse {
            tx_hash: hash.to_string(),
            status: "pending".into(),
            block_number: None,
        })),
        Err(e) => Err(err(StatusCode::BAD_GATEWAY, format!("rpc error: {e}"))),
    }
}
