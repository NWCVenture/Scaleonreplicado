"use client";

import * as pdfjs from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Configure worker for browser-side PDF rendering
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export { pdfjs };
export { PDFDocument, StandardFonts, rgb };
