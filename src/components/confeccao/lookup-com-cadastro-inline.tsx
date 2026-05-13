"use client";

// <LookupComCadastroInline /> — Combobox/Popover com busca debounced
// + botão "+ Novo" que abre Dialog inline pra cadastrar e selecionar.
//
// Genérico — funciona para produtos, fornecedores, tipos de tecido, cores.
// O caller fornece o endpoint da entidade + o label e o componente de
// formulário do cadastro inline.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface LookupItem {
  id: string;
  nome: string;
}

interface ListResponse<T extends LookupItem> {
  items: T[];
  total: number;
}

export interface LookupComCadastroInlineProps<T extends LookupItem> {
  // Endpoint da entidade — ex: "/api/confeccao/produtos"
  endpoint: string;
  // Query string extra (ex: filtro de categoria)
  extraQuery?: Record<string, string | undefined>;
  // Item selecionado (id) — controlado pelo pai
  value?: string;
  onChange: (id: string, item: T) => void;
  // Label e textos
  placeholder?: string;
  entidadeLabel?: string; // ex: "produto", "fornecedor"
  // Se true, mostra botão "+ Novo" no final da lista
  permiteCadastrar?: boolean;
  // Componente de formulário de cadastro inline (mostrado em Dialog)
  // Recebe `onCreated(item)` pra avisar quando o cadastro foi feito.
  cadastroInlineRender?: (props: {
    onCreated: (item: T) => void;
    onCancel: () => void;
  }) => React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function LookupComCadastroInline<T extends LookupItem>(
  props: LookupComCadastroInlineProps<T>,
) {
  const {
    endpoint,
    extraQuery,
    value,
    onChange,
    placeholder = "Selecionar...",
    entidadeLabel = "item",
    permiteCadastrar = true,
    cadastroInlineRender,
    disabled,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Para mostrar o label do item selecionado mesmo antes de carregar a lista
  const [selectedItem, setSelectedItem] = useState<T | null>(null);

  // Debounce de busca
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchItems = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({
          pageSize: "20",
          incluirInativos: "false",
        });
        if (query) sp.set("search", query);
        if (extraQuery) {
          for (const [k, v] of Object.entries(extraQuery)) {
            if (v) sp.set(k, v);
          }
        }
        const res = await fetch(`${endpoint}?${sp.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as ListResponse<T>;
        setItems(data.items);
      } catch (err) {
        console.warn("[LookupComCadastroInline] busca falhou:", err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [endpoint, extraQuery],
  );

  // Recarrega quando abre ou search muda
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchItems(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, search, fetchItems]);

  // Quando value muda externamente e ainda não temos selectedItem, busca-o
  useEffect(() => {
    if (!value) {
      setSelectedItem(null);
      return;
    }
    if (selectedItem?.id === value) return;
    // Tenta encontrar na lista atual
    const found = items.find((i) => i.id === value);
    if (found) {
      setSelectedItem(found);
      return;
    }
    // Busca direta pela rota GET single
    void (async () => {
      try {
        const res = await fetch(`${endpoint}/${value}`, { cache: "no-store" });
        if (!res.ok) return;
        const { item } = (await res.json()) as { item: T };
        setSelectedItem(item);
      } catch {
        /* silencioso */
      }
    })();
  }, [value, items, selectedItem, endpoint]);

  const handleCreated = (item: T) => {
    setItems((prev) => [item, ...prev]);
    setSelectedItem(item);
    onChange(item.id, item);
    setCreateOpen(false);
    setOpen(false);
    toast.success(`${entidadeLabel} cadastrado`);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("justify-between font-normal", className)}
            disabled={disabled}
          >
            <span className="truncate">
              {selectedItem?.nome ?? placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0"
          align="start"
          style={{ width: "var(--radix-popover-trigger-width)" }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Buscar ${entidadeLabel}…`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {loading && (
                <div className="py-3 text-center text-xs text-muted-foreground">
                  Carregando…
                </div>
              )}
              {!loading && items.length === 0 && (
                <CommandEmpty>Nenhum {entidadeLabel} encontrado.</CommandEmpty>
              )}
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      setSelectedItem(item);
                      onChange(item.id, item);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value === item.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {item.nome}
                  </CommandItem>
                ))}
              </CommandGroup>
              {permiteCadastrar && cadastroInlineRender && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="__novo__"
                      onSelect={() => {
                        setOpen(false);
                        setCreateOpen(true);
                      }}
                    >
                      <Plus className="mr-2 size-4" />
                      Novo {entidadeLabel}
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {permiteCadastrar && cadastroInlineRender && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Novo {entidadeLabel}</DialogTitle>
            </DialogHeader>
            {cadastroInlineRender({
              onCreated: handleCreated,
              onCancel: () => setCreateOpen(false),
            })}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
