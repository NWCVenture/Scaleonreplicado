"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";

interface ModalCriarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nome: string, descricao: string) => Promise<void>;
}

export function ModalCriar({ open, onOpenChange, onSubmit }: ModalCriarProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!nome.trim()) return;
    setIsSubmitting(true);
    try {
      await onSubmit(nome.trim().toUpperCase(), descricao.trim());
      setNome("");
      setDescricao("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Estante</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome da Estante</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: ESTANTE A"
              className="bg-slate-800 border-slate-600"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div className="space-y-2">
            <Label>Descricao (opcional)</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descricao..."
              className="bg-slate-800 border-slate-600"
            />
          </div>
          <Button
            className="w-full"
            disabled={!nome.trim() || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {isSubmitting ? "Criando..." : "Criar Estante"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
