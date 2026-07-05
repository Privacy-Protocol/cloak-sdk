import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { usePublicClient, useWalletClient, useChainId } from "wagmi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { CloakClient } from "../client";
import type { NoteStore } from "../store";
import type { Note } from "../note";
import type { SendParams } from "../client";

export interface CloakProviderProps {
  poolAddress: Address;
  relayerUrl: string;
  deployBlock?: bigint;
  store?: NoteStore;
  children: ReactNode;
}

const CloakContext = createContext<CloakClient | null>(null);

/**
 * Wire Cloak into a wagmi app. Reads the connected public/wallet clients and
 * exposes a `CloakClient` to the hooks below. Place inside WagmiProvider and
 * QueryClientProvider.
 */
export function CloakProvider({ poolAddress, relayerUrl, deployBlock, store, children }: CloakProviderProps) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  const client = useMemo(() => {
    if (!publicClient) return null;
    return new CloakClient({
      publicClient: publicClient as PublicClient,
      walletClient: walletClient ?? undefined,
      poolAddress,
      relayerUrl,
      chainId,
      deployBlock,
      store,
    });
  }, [publicClient, walletClient, poolAddress, relayerUrl, chainId, deployBlock, store]);

  return <CloakContext.Provider value={client}>{children}</CloakContext.Provider>;
}

/** The underlying CloakClient. Throws if used outside CloakProvider. */
export function useCloak(): CloakClient {
  const client = useContext(CloakContext);
  if (!client) throw new Error("useCloak must be used within <CloakProvider> with a connected client");
  return client;
}

const NOTES_KEY = ["cloak", "notes"];
const CLAIMS_KEY = ["cloak", "claimables"];

/** Deposit into the pool. Returns a react-query mutation. */
export function useDeposit() {
  const client = useCloak();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { asset: Address; amount: bigint }) => client.deposit(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTES_KEY });
    },
  });
}

/** Forward a transaction / transfer through the pool via the relayer. */
export function useCloakSend() {
  const client = useCloak();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: SendParams) => client.send(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTES_KEY });
      qc.invalidateQueries({ queryKey: CLAIMS_KEY });
    },
  });
}

/** Withdraw a note to any address. */
export function useWithdraw() {
  const client = useCloak();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { note: Note; to: Address; amount?: bigint; fee?: bigint }) =>
      client.withdraw(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

/** Withdraw a harvested claim note. */
export function useClaim() {
  const client = useCloak();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { claimNote: Note; to: Address; fee?: bigint }) => client.claim(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAIMS_KEY }),
  });
}

/** Spendable notes, kept in sync with on-chain state. */
export function useNotes() {
  const client = useCloak();
  return useQuery({
    queryKey: NOTES_KEY,
    queryFn: async () => {
      await client.sync();
      return client.getNotes();
    },
  });
}

/** Discovered claim notes (returned funds) ready to withdraw. */
export function useClaimables() {
  const client = useCloak();
  return useQuery({
    queryKey: CLAIMS_KEY,
    queryFn: async () => {
      await client.sync();
      return client.getClaimables();
    },
  });
}
