import { useState } from "react";
import { ChevronsUpDown, Loader2, X } from "lucide-react";
import { useOwners } from "@/hooks/useOwners";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function OwnerCombobox({
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
  placeholder = "Search a client…",
}: {
  selectedId: string | null;
  selectedLabel: string | null;
  onSelect: (id: string, label: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: owners = [], isLoading } = useOwners(search);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-10 w-full justify-between font-normal", !selectedId && "text-muted-foreground")}
          data-testid="transport-owner-combobox"
        >
          <span className="truncate text-left">{selectedLabel || placeholder}</span>
          {selectedId ? (
            <span
              role="button"
              className="ml-2 rounded-sm p-0.5 hover:bg-muted"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
            >
              <X className="h-4 w-4 opacity-60" />
            </span>
          ) : isLoading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isLoading ? "Searching…" : "Nobody matches."}</CommandEmpty>
            <CommandGroup>
              {owners.slice(0, 30).map((owner) => {
                const label = ownerDisplayName(owner.first_name, owner.last_name);
                const pets = (owner.pets ?? []).map((p) => p.name).filter(Boolean).join(", ");
                return (
                  <CommandItem
                    key={owner.id}
                    value={owner.id}
                    onSelect={() => {
                      onSelect(owner.id, label);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">
                      {label}
                      {pets ? <span className="text-muted-foreground"> · {pets}</span> : null}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
