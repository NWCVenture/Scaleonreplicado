"use client";

import { useState, useCallback, useRef } from "react";
import type {
  TipoColeta,
  ContaOperacao,
} from "@/types/coletas";
import type {
  DevolucaoFormData,
  DevolucoesMap,
  CarrierPattern,
  SkuKitRule,
} from "@/types/coletas";
import { extractFlexIds, extractShippingIds } from "@/lib/coletas-utils";

export function useColetasBipagem() {
  // Core state
  const [ids, setIds] = useState<string[]>([]);
  const [devolucoesData, setDevolucoesData] = useState<DevolucoesMap>({});
  const [currentFunction, setCurrentFunction] = useState<TipoColeta>("COLETA");
  const [currentAccount, setCurrentAccount] =
    useState<ContaOperacao>("TIKTOK_SHOP");
  const [inputValue, setInputValue] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState<
    "success" | "error" | "warning" | ""
  >("");
  const [dedup, setDedup] = useState(true);
  const [autoClear, setAutoClear] = useState(true);

  // Config state (loaded from API by parent)
  const [carrierPatterns, setCarrierPatterns] = useState<CarrierPattern[]>([]);
  const [kitRules, setKitRules] = useState<SkuKitRule[]>([]);
  const [skuCatalog, setSkuCatalog] = useState<string[]>([]);

  // Refs for scan debounce
  const processTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedText = useRef("");
  // Always-current snapshot of ids — avoids stale closures in processText
  const idsRef = useRef<string[]>([]);
  idsRef.current = ids;

  // processText: extract IDs from scanned text, detect carriers, add to list
  // Returns { newIds, duplicates } for parent to play sounds
  const processText = useCallback(
    (text: string): { newIds: string[]; duplicates: string[] } => {
      if (!text.trim() || text.trim() === lastProcessedText.current) {
        return { newIds: [], duplicates: [] };
      }
      lastProcessedText.current = text.trim();

      let extracted: string[];
      if (currentFunction === "FLEX") {
        extracted = extractFlexIds(text);
        if (extracted.length === 0) {
          extracted = extractShippingIds(text);
        }
      } else {
        extracted = extractShippingIds(text);
      }

      // Compute new/duplicates synchronously using the ref snapshot.
      // Do NOT use side effects inside the setIds updater — React 18 batching
      // defers updater execution in production, so values read after setIds()
      // would be stale (empty arrays), preventing the modal from opening.
      const currentIds = idsRef.current;
      const newIds: string[] = [];
      const duplicates: string[] = [];

      extracted.forEach((id) => {
        if (dedup && currentIds.includes(id)) {
          duplicates.push(id);
        } else {
          newIds.push(id);
        }
      });

      if (newIds.length > 0) {
        setIds((prev) => [...prev, ...newIds]);
        setStatusMsg(`+${newIds.length} pacote(s)`);
        setStatusType("success");
      } else if (duplicates.length > 0) {
        setStatusMsg("Duplicado(s) ignorado(s)");
        setStatusType("warning");
      }

      return { newIds, duplicates };
    },
    [currentFunction, dedup],
  );

  // handleInput: called on textarea change, debounces processing
  const handleInput = useCallback(
    (value: string) => {
      setInputValue(value);
      if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
      processTimeoutRef.current = setTimeout(() => {
        processText(value);
        if (autoClear) {
          setInputValue("");
        }
      }, 5);
    },
    [processText, autoClear],
  );

  const addId = useCallback(
    (id: string) => {
      setIds((prev) => (dedup && prev.includes(id) ? prev : [...prev, id]));
    },
    [dedup],
  );

  const removeId = useCallback((id: string) => {
    setIds((prev) => prev.filter((i) => i !== id));
    setDevolucoesData((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setStatusMsg("");
    setStatusType("");
    lastProcessedText.current = "";
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    setDevolucoesData({});
    setInputValue("");
    setStatusMsg("");
    setStatusType("");
    lastProcessedText.current = "";
  }, []);

  const setDevolucao = useCallback(
    (pacoteId: string, data: DevolucaoFormData) => {
      setDevolucoesData((prev) => ({ ...prev, [pacoteId]: data }));
    },
    [],
  );

  const removeDevolucao = useCallback((pacoteId: string) => {
    setDevolucoesData((prev) => {
      const next = { ...prev };
      delete next[pacoteId];
      return next;
    });
  }, []);

  // Load from temp save
  const loadFromTemp = useCallback(
    (
      dados: {
        pacotes?: Array<{ codigo: string }>;
        devolucoes?: Record<string, Record<string, unknown>>;
      },
      tipo: TipoColeta,
      conta: ContaOperacao,
    ) => {
      const pacotes = dados.pacotes || [];
      setIds(pacotes.map((p) => p.codigo));
      const devMap: DevolucoesMap = {};
      if (dados.devolucoes) {
        for (const [key, val] of Object.entries(dados.devolucoes)) {
          const v = val as Record<string, unknown>;
          devMap[key] = {
            skuLines: (v.skuLines as DevolucaoFormData["skuLines"]) || [],
            operacao: v.operacao as ContaOperacao,
            avaria: v.avaria === "SIM" || v.avaria === true,
            obs: (v.obs as string) || "",
            tipo: v.tipo as TipoColeta,
          };
        }
      }
      setDevolucoesData(devMap);
      setCurrentFunction(tipo);
      setCurrentAccount(conta);
      setInputValue("");
      lastProcessedText.current = "";
    },
    [],
  );

  // getExportData: return data shaped for API POST
  const getExportData = useCallback(
    () => ({
      ids,
      devolucoesData,
      currentFunction,
      currentAccount,
    }),
    [ids, devolucoesData, currentFunction, currentAccount],
  );

  return {
    ids,
    devolucoesData,
    currentFunction,
    currentAccount,
    inputValue,
    statusMsg,
    statusType,
    dedup,
    autoClear,
    carrierPatterns,
    kitRules,
    skuCatalog,
    processText,
    handleInput,
    addId,
    removeId,
    clear,
    setCurrentFunction,
    setCurrentAccount,
    setDedup,
    setAutoClear,
    setDevolucao,
    removeDevolucao,
    loadFromTemp,
    getExportData,
    setCarrierPatterns,
    setKitRules,
    setSkuCatalog,
    setInputValue,
  };
}
