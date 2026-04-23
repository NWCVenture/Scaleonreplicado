export type SkuGenInput = {
  modelo: string;
  cores: string[];
  tamanhos: string[];
};

function norm(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

function sortAlpha(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function compose(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

export function generateSimple(input: SkuGenInput): string[] {
  const modelo = norm(input.modelo);
  if (!modelo) return [];
  const cores = sortAlpha(input.cores.map(norm).filter(Boolean));
  const tamanhos = input.tamanhos.map(norm).filter(Boolean);
  if (tamanhos.length === 0) return [];

  const out: string[] = [];
  if (cores.length === 0) {
    for (const t of tamanhos) out.push(compose([modelo, t]));
  } else {
    for (const c of cores) {
      for (const t of tamanhos) out.push(compose([modelo, c, t]));
    }
  }
  return out;
}

function pairsWithReplacement(cores: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < cores.length; i++) {
    for (let j = i; j < cores.length; j++) {
      out.push([cores[i], cores[j]]);
    }
  }
  return out;
}

function partitionsOf3(cores: string[]): { color: string; count: number }[][] {
  const out: { color: string; count: number }[][] = [];
  const n = cores.length;

  for (let i = 0; i < n; i++) {
    out.push([{ color: cores[i], count: 3 }]);
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      out.push([
        { color: cores[i], count: 2 },
        { color: cores[j], count: 1 },
      ]);
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        out.push([
          { color: cores[i], count: 1 },
          { color: cores[j], count: 1 },
          { color: cores[k], count: 1 },
        ]);
      }
    }
  }

  return out;
}

export function generateKit2(input: SkuGenInput): string[] {
  const modelo = norm(input.modelo);
  if (!modelo) return [];
  const cores = sortAlpha(input.cores.map(norm).filter(Boolean));
  const tamanhos = input.tamanhos.map(norm).filter(Boolean);
  if (cores.length === 0 || tamanhos.length === 0) return [];

  const pairs = pairsWithReplacement(cores);
  const out: string[] = [];
  for (const [a, b] of pairs) {
    const colorPart = a === b ? a : `${a} ${b}`;
    for (const t of tamanhos) {
      out.push(compose(["KIT 2", modelo, colorPart, t]));
    }
  }
  return out;
}

export function generateKit3(input: SkuGenInput): string[] {
  const modelo = norm(input.modelo);
  if (!modelo) return [];
  const cores = sortAlpha(input.cores.map(norm).filter(Boolean));
  const tamanhos = input.tamanhos.map(norm).filter(Boolean);
  if (cores.length === 0 || tamanhos.length === 0) return [];

  const partitions = partitionsOf3(cores);
  const out: string[] = [];
  for (const partition of partitions) {
    const sorted = [...partition].sort((a, b) =>
      a.color.localeCompare(b.color, "pt-BR"),
    );
    let colorPart: string;
    if (sorted.length === 1) {
      colorPart = sorted[0].color;
    } else {
      colorPart = sorted.map((p) => `${p.count} ${p.color}`).join(" ");
    }
    for (const t of tamanhos) {
      out.push(compose(["KIT 3", modelo, colorPart, t]));
    }
  }
  return out;
}

export function generateMix3(input: SkuGenInput): string[] {
  const modelo = norm(input.modelo);
  if (!modelo) return [];
  const cores = input.cores.map(norm).filter(Boolean);
  const tamanhos = input.tamanhos.map(norm).filter(Boolean);
  if (cores.length !== 3 || tamanhos.length === 0) return [];

  const out: string[] = [];
  for (const t of tamanhos) {
    out.push(compose(["MIX 3", modelo, t]));
  }
  return out;
}

export type SkuGenOptions = {
  simple: boolean;
  kit2: boolean;
  kit3: boolean;
  mix3: boolean;
};

export function generateAll(
  input: SkuGenInput,
  opts: SkuGenOptions,
): string[] {
  const all: string[] = [];
  if (opts.simple) all.push(...generateSimple(input));
  if (opts.kit2) all.push(...generateKit2(input));
  if (opts.kit3) all.push(...generateKit3(input));
  if (opts.mix3) all.push(...generateMix3(input));
  return Array.from(new Set(all));
}
