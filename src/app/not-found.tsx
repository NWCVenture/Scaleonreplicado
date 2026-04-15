import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <AlertCircle className="h-16 w-16 text-destructive mx-auto animate-pulse" />
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <p className="text-xl text-muted-foreground">
          Pagina nao encontrada
        </p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          A pagina que voce esta procurando nao existe ou foi removida.
          Verifique o endereco e tente novamente.
        </p>
        <Button asChild>
          <Link href="/">Voltar para Home</Link>
        </Button>
      </div>
    </div>
  );
}
