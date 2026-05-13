"use client";

// Wrapper de <LookupComCadastroInline /> pra selecionar membros ativos
// da conta. Não permite cadastro inline (gestão de usuários é em /gerenciar-usuarios).

import {
  LookupComCadastroInline,
  type LookupItem,
} from "./lookup-com-cadastro-inline";

interface MembroConta extends LookupItem {
  email: string;
  papel: string;
}

export interface LookupUsuarioContaProps {
  value?: string;
  onChange: (id: string, item: MembroConta) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function LookupUsuarioConta(props: LookupUsuarioContaProps) {
  return (
    <LookupComCadastroInline<MembroConta>
      endpoint="/api/confeccao/membros-conta"
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder ?? "Selecionar usuário…"}
      entidadeLabel="usuário"
      permiteCadastrar={false}
      disabled={props.disabled}
      className={props.className}
    />
  );
}
