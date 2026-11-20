import type { QueryClient } from "@tanstack/react-query";
import { ledgerClosingQueryKey } from "@/hooks/useLedgerClosing";
import { statementQueryKey } from "@/hooks/useStatement";

export function invalidateOwnerStatementQueries(
  queryClient: QueryClient,
  ownerId: string,
) {
  queryClient.invalidateQueries({ queryKey: statementQueryKey(ownerId) });
  queryClient.invalidateQueries({ queryKey: ledgerClosingQueryKey(ownerId) });
  queryClient.invalidateQueries({ queryKey: ["ledger_statement", ownerId] });
  queryClient.invalidateQueries({ queryKey: ["statement", ownerId] });
  queryClient.invalidateQueries({ queryKey: ["owner_wallet", ownerId] });
  queryClient.invalidateQueries({ queryKey: ["wallet_transactions", ownerId] });
  queryClient.invalidateQueries({ queryKey: ["account-balance", ownerId] });
}
