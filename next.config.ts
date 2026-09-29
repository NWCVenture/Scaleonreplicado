import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.15.7"],

  // Sem raiz explícita, o Turbopack sobe a árvore procurando lockfile e pode
  // eleger o diretório do usuário como raiz do workspace (basta existir um
  // package-lock.json em C:\Users\<nome>, o que é comum). Quando isso
  // acontece, ele passa a procurar node_modules lá e o dev server responde
  // 404 em tudo, inclusive /login.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
