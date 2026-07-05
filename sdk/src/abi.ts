/** Minimal CloakPool ABI covering everything the SDK reads and writes. */
export const cloakPoolAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "spend",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "sp",
        type: "tuple",
        components: [
          { name: "proof", type: "bytes" },
          { name: "root", type: "bytes32" },
          { name: "nullifierHash", type: "bytes32" },
          { name: "changeCommitment", type: "bytes32" },
          { name: "spendValue", type: "uint256" },
          { name: "fee", type: "uint256" },
        ],
      },
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
          { name: "relayer", type: "address" },
          { name: "claimInner", type: "bytes32" },
          { name: "returnAsset", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "returnData", type: "bytes" }],
  },
  {
    type: "function",
    name: "intentHash",
    stateMutability: "view",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
          { name: "relayer", type: "address" },
          { name: "claimInner", type: "bytes32" },
          { name: "returnAsset", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "nullifierUsed",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isKnownRoot",
    stateMutability: "view",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "currentRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "proxyAddress",
    stateMutability: "view",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "leafIndex", type: "uint32", indexed: false },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Spent",
    inputs: [
      { name: "nullifierHash", type: "bytes32", indexed: true },
      { name: "changeCommitment", type: "bytes32", indexed: false },
      { name: "changeLeafIndex", type: "uint32", indexed: false },
      { name: "intentHash", type: "bytes32", indexed: false },
      { name: "proxy", type: "address", indexed: false },
      { name: "returnData", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClaimNoteCreated",
    inputs: [
      { name: "nullifierHash", type: "bytes32", indexed: true },
      { name: "commitment", type: "bytes32", indexed: false },
      { name: "leafIndex", type: "uint32", indexed: false },
      { name: "returnAsset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** ERC20 approve, for token deposits. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
