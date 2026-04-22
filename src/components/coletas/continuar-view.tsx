"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import type { BipagemTemporariaRecord } from "@/types/coletas";
import { FUNCTION_DISPLAY, OPERATION_DISPLAY } from "@/types/coletas";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Play, Trash2, Package, Truck, RotateCcw } from "lucide-react";

interface ContinuarViewProps {
  temporarias: BipagemTemporariaRecord[];
  onResume: (temp: BipagemTemporariaRecord) => void;
  onDelete: (id: string) => void;
}

function TipoIcon({ tipo }: { tipo: string }) {
  if (tipo === "COLETA") return <Truck className="h-4 w-4" />;
  if (tipo === "DEVOLUCAO") return <RotateCcw className="h-4 w-4" />;
  return null;
}

export function ContinuarView({
  temporarias,
  onResume,
  onDelete,
}: ContinuarViewProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (temporarias.length === 0) {
    return (
      <Card className="bg-zinc-950 border-zinc-800">
        <CardContent className="py-12 text-center">
          <Package className="h-12 w-12 mx-auto mb-4 text-zinc-600" />
          <p className="text-zinc-400">Nenhuma bipagem temporaria</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {temporarias.map((temp) => (
        <Card key={temp.id} className="bg-zinc-950 border-zinc-800">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn(
                      "flex items-center gap-1",
                      temp.tipo === "FLEX"
                        ? "bg-green-700/20 text-green-500 border-green-700/30"
                        : temp.tipo === "COLETA"
                          ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                          : temp.tipo === "DEVOLUCAO"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-amber-500/20 text-amber-400 border-amber-500/30",
                    )}
                  >
                    <TipoIcon tipo={temp.tipo} />
                    {FUNCTION_DISPLAY[temp.tipo]}
                  </Badge>
                  <span className="text-sm font-medium text-zinc-300">
                    {OPERATION_DISPLAY[temp.conta]}
                  </span>
                  <span className="text-sm font-bold text-zinc-100">
                    {temp.total} pacote(s)
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Salvo em {formatDate(temp.createdAt)}
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <Button
                  size="sm"
                  onClick={() => onResume(temp)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Play className="mr-1 h-4 w-4" /> Continuar
                </Button>
                <AlertDialog
                  open={deletingId === temp.id}
                  onOpenChange={(open) =>
                    setDeletingId(open ? temp.id : null)
                  }
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-zinc-700 text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-zinc-950 border-zinc-800">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-zinc-100">
                        Excluir bipagem temporaria?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-zinc-400">
                        Esta acao nao pode ser desfeita. A bipagem temporaria
                        com {temp.total} pacote(s) sera removida
                        permanentemente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                        Cancelar
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          onDelete(temp.id);
                          setDeletingId(null);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
