// One-shot: extrai trackingIds + barcodes do PDF do user usando a MESMA
// regex que o front roda em pdf-expedicao-utils.ts. Imprime página a página
// pra a gente cruzar com tracking_id_impresso e ver se o falso-positivo
// vem de extração errada ou de lixo no banco.

import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Uso: tsx scripts/debug-extract-tracking.ts <pdf>");
  process.exit(1);
}

async function run() {
  const buf = readFileSync(path);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const pdf = await pdfjs.getDocument({
    data: u8,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  console.log(`PDF: ${path} — ${pdf.numPages} páginas\n`);

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");

    const labeledTrack = text.match(
      /(?:C[oó]digo\s+de\s+Rastreamento|Tracking(?:\s+Number|\s+ID)?|Rastreio|AWB)\s*[:#]?\s*([A-Z0-9]{8,30})/i,
    );
    let trackingId = labeledTrack ? labeledTrack[1] : "";

    let carrier = "Outro";
    if (/imile/i.test(text)) carrier = "iMile";
    else if (/jadlog/i.test(text)) carrier = "JadLog";
    else if (/j&t|j\s*&\s*t express|99988\d/i.test(text)) carrier = "J&T";

    let jadlogBarcode = "";
    if (carrier === "JadLog") {
      const jm = text.match(/\b(139\d{8,}?)(?:\$|\b)/);
      if (jm) jadlogBarcode = jm[1];
    }
    let jtBarcode = "";
    if (carrier === "J&T") {
      const jt = text.match(/\b(99988\d\d{6,}?)(?:\$|\b)/);
      if (jt) jtBarcode = jt[1];
    }

    let cpfFromPDF = "";
    const cpfMatch =
      text.match(/CPF[\/\s]*CNPJ[:\s]*([\d.\-\/]+)/i) ||
      text.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/) ||
      text.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
    if (cpfMatch) cpfFromPDF = cpfMatch[1].replace(/\D/g, "");

    if (!trackingId && jtBarcode) trackingId = jtBarcode;
    if (!trackingId && jadlogBarcode) trackingId = jadlogBarcode;
    if (!trackingId && carrier === "iMile") {
      const cpfDigits = cpfFromPDF;
      const candidates = Array.from(text.matchAll(/\b(\d{12,18})\b/g))
        .map((m) => m[1])
        .filter((d) => d !== cpfDigits);
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.length - a.length);
        trackingId = candidates[0];
      }
    }

    const bensMatch = text.match(
      /IDENTIFICA[CÇ][AÃ]O\s+DOS\s+BENS([\s\S]*?)(?:\d{2}-\d{2}-\d{4}|Total\s+\d|$)/i,
    );
    const bens = bensMatch ? bensMatch[1].slice(0, 120).replace(/\s+/g, " ") : "";

    console.log(
      `p${String(i).padStart(3, "0")} ` +
        `carrier=${carrier.padEnd(7)} ` +
        `tid=${(trackingId || "(sem)").padEnd(20)} ` +
        `bens="${bens}"`,
    );
  }
}

run().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
