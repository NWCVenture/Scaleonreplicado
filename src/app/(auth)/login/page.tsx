"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Loader2 } from "lucide-react";

const demoUsers = [
  { email: "admin@nwc.com", password: "admin123", role: "admin" },
  { email: "funcionario@nwc.com", password: "func1234", role: "funcionario" },
  { email: "igor@nwc.com", password: "12345678", role: "admin" },
  { email: "victor@nwc.com", password: "12345678", role: "admin" },
  { email: "fellicio@nwc.com", password: "12345678", role: "admin" },
  { email: "beatriz@nwc.com", password: "12345678", role: "funcionario" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn.email(
      { email, password },
      {
        onSuccess: () => {
          toast.success("Login realizado com sucesso!");
          router.push("/");
        },
        onError: (ctx) => {
          toast.error(ctx.error?.message || "Email ou senha incorretos!");
        },
      },
    );

    if (error) {
      toast.error(error.message || "Email ou senha incorretos!");
    }

    setLoading(false);
  }

  function fillCredentials(userEmail: string, userPassword: string) {
    setEmail(userEmail);
    setPassword(userPassword);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Acesse o sistema NWC ERP</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-lg"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              Usuários demo:
            </p>
            <div className="space-y-1">
              {demoUsers.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  onClick={() => fillCredentials(user.email, user.password)}
                  className="block w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="font-mono">
                    {user.email} / {user.password}
                  </span>{" "}
                  <span className="text-muted-foreground/60">
                    ({user.role})
                  </span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
