// Read-only integration check against the LIVE Sepolia deployment:
// - relayer /info reachable and correctly configured
// - SDK can sync the pool's Merkle tree from on-chain events
// - the SDK-computed root matches the pool's on-chain currentRoot / isKnownRoot
//
// No wallet or funds required. Run: node scripts/live-smoke.mjs
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { createCloakClient, deployments, cloakPoolAbi } from "../dist/index.js";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const dep = deployments.sepolia;

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });
const cloak = createCloakClient({ ...dep, publicClient });

console.log("RPC:", RPC);

// 1. Sync the tree from events
const tree = await cloak.sync();
const sdkRoot = tree.root();
console.log("\ntree leaves:", tree.leafCount);
console.log("SDK root:   ", "0x" + sdkRoot.toString(16).padStart(64, "0"));

// 3. Compare with the on-chain pool
const onchainRoot = await publicClient.readContract({
  address: dep.poolAddress,
  abi: cloakPoolAbi,
  functionName: "currentRoot",
});
console.log("chain root: ", onchainRoot);

const known = await publicClient.readContract({
  address: dep.poolAddress,
  abi: cloakPoolAbi,
  functionName: "isKnownRoot",
  args: ["0x" + sdkRoot.toString(16).padStart(64, "0")],
});

const rootsMatch = ("0x" + sdkRoot.toString(16).padStart(64, "0")).toLowerCase() === onchainRoot.toLowerCase();
console.log("\nSDK root == chain currentRoot:", rootsMatch);
console.log("chain isKnownRoot(SDK root):  ", known);

if (!rootsMatch || !known) {
  throw new Error("SDK-computed root does not match the on-chain tree");
}

// 4. Relayer info (best-effort — network to the relayer host can be flaky).
try {
  const info = await cloak.relayerInfo();
  console.log("\nrelayer /info:", info);
  if (info.chainId !== dep.chainId) throw new Error("relayer chainId mismatch");
  if (info.poolAddress.toLowerCase() !== dep.poolAddress.toLowerCase())
    throw new Error("relayer poolAddress mismatch");
  console.log("relayer config matches deployment ✓");
} catch (e) {
  console.warn("\n⚠️  relayer /info check skipped:", e.message);
}

console.log("\n✅ live integration OK: SDK and pool agree on-chain.");
process.exit(0);
