import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Branch = { id: string; code: string; name: string; short_name: string };

type BranchState = {
  branches: Branch[];
  branchId: string | null;
  branchLocked: boolean;
  branchShortName: string | null;
  loading: boolean;
};

const BranchContext = createContext<BranchState>({
  branches: [],
  branchId: null,
  branchLocked: true,
  branchShortName: null,
  loading: true,
});

/** Woof has one facility. The branch row exists so transport rows keep a branch_id for a later hub push. */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["branches"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, code, name, short_name").order("name");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });
  const home = data.find((b) => b.code === "woof") ?? data[0] ?? null;
  return (
    <BranchContext.Provider
      value={{
        branches: data,
        branchId: home?.id ?? null,
        branchLocked: data.length <= 1,
        branchShortName: home?.short_name ?? null,
        loading: isLoading,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
