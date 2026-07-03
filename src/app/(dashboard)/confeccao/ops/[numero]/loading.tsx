// Boundary de loading das páginas da OP: mantém a barra de abas (layout)
// visível e responde imediato à navegação quando o prefetch da rota
// expirou. Também habilita o prefetch parcial padrão de rotas dinâmicas.
export default function Loading() {
  return <div className="text-sm text-muted-foreground">Carregando…</div>;
}
