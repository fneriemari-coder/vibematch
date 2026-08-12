import { Logger } from '@nestjs/common';

/**
 * Turns an uploaded file into analysable text — or reports honestly that it
 * could not.
 *
 * The failure case is the one that matters. A scanned contract is a PDF full
 * of pixels with no text layer, and `pdf-parse` returns an empty string for
 * it without erroring. Storing that as a document would give the user an
 * analysis screen that answers questions about a file nobody read. So this
 * returns a discriminated result and the caller refuses the upload with an
 * explanation instead.
 */

const logger = new Logger('DocumentExtractor');

/** Everything the workspace accepts. Enforced again in the controller's fileFilter. */
export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
] as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Below this many characters of real content there is nothing to analyse.
 * Tuned against the failure it exists for: a scanned PDF typically yields 0–30
 * characters of stray ligatures, while even a one-paragraph contract clears
 * 200 comfortably.
 */
const MIN_USEFUL_CHARS = 120;

export type ExtractionResult =
  | { ok: true; text: string; pages?: number }
  | { ok: false; reason: 'NO_TEXT_LAYER' | 'UNREADABLE' | 'TOO_SHORT'; message: string };

/** `pdf-parse` ships an unconditional debug block in its index.js that reads a
 * bundled test PDF off disk. Requiring the library file directly skips it, and
 * doing it lazily keeps pdfjs out of the boot path of a process that may never
 * see a PDF. */
type PdfParseFn = (data: Buffer) => Promise<{ text: string; numpages: number }>;

function loadPdfParse(): PdfParseFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('pdf-parse/lib/pdf-parse.js') as PdfParseFn;
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const text =
    mimeType === 'application/pdf' ? await extractPdf(buffer, filename) : extractPlain(buffer, mimeType);

  if (text === null) {
    return {
      ok: false,
      reason: 'UNREADABLE',
      message:
        `Não consegui ler “${filename}”. O arquivo chegou, mas o conteúdo não pôde ser decodificado como texto — ` +
        'confira se ele não está corrompido ou protegido por senha e envie novamente.',
    };
  }

  const clean = cleanup(text);
  const meaningful = clean.replace(/[^\p{L}\p{N}]/gu, '').length;

  if (meaningful < MIN_USEFUL_CHARS) {
    if (mimeType === 'application/pdf') {
      return {
        ok: false,
        reason: 'NO_TEXT_LAYER',
        message:
          `“${filename}” não tem texto selecionável. Extraí ${meaningful} caractere(s) úteis do PDF, ` +
          'o que indica um documento digitalizado (as páginas são imagens). Não vou guardar um documento vazio ' +
          'nem analisar o que não li: reenvie o PDF original gerado pelo editor, ou passe este arquivo por OCR antes de subir.',
      };
    }
    return {
      ok: false,
      reason: 'TOO_SHORT',
      message:
        `“${filename}” tem só ${meaningful} caractere(s) de conteúdo — pouco demais para uma análise honesta. ` +
        'Envie o documento completo.',
    };
  }

  return { ok: true, text: clean };
}

function extractPlain(buffer: Buffer, mimeType: string): string | null {
  const text = buffer.toString('utf8');
  // A binary file renamed to .txt decodes into replacement characters. If more
  // than a couple percent of the result is U+FFFD, this is not text.
  const replacements = (text.match(/\ufffd/g) ?? []).length;
  if (text.length > 0 && replacements / text.length > 0.02) return null;

  if (mimeType === 'application/json') {
    // Pretty-print so the analyser's sentence/line splitting has something to
    // work with — a minified JSON export is one 40k-character "line".
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

async function extractPdf(buffer: Buffer, filename: string): Promise<string | null> {
  try {
    const pdfParse = loadPdfParse();
    const parsed = await pdfParse(buffer);
    return parsed.text ?? '';
  } catch (err) {
    logger.warn(`pdf-parse failed on ${filename}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Normalizes whitespace without destroying structure: PDF extraction leaves
 * ragged spacing and hard line breaks mid-sentence, but the line breaks
 * between clauses are exactly what the analyser quotes against.
 */
function cleanup(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
