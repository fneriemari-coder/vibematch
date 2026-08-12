/**
 * Shared text primitives for the AI analysis workspace.
 *
 * Everything here exists because the analyser has to point at a real line in
 * the user's own file. Matching is done on a normalized copy (lowercase, no
 * diacritics) while quoting always comes from the ORIGINAL string, so the user
 * reads back exactly what they wrote, accents and capitals included.
 */

/** Lowercase + strip diacritics, so "rescisão" and "RESCISAO" both match. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Splits on sentence terminators AND newlines. Contracts are written as
 * numbered clauses and proposals as bullet lists at least as often as they are
 * written in prose; a "sentence" that swallowed four clauses would quote back
 * something nobody reads.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Non-empty lines, preserved in order — the unit a spreadsheet export works in. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const DEFAULT_QUOTE_LENGTH = 240;

/** Collapses whitespace and caps length, so a quote is always renderable. */
export function trimQuote(sentence: string, maxLength = DEFAULT_QUOTE_LENGTH): string {
  const clean = sentence.replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trimEnd()}…`;
}

/** A sentence and its normalized twin, computed once and reused by every pass. */
export interface IndexedText {
  original: string;
  sentences: string[];
  normalizedSentences: string[];
  normalizedAll: string;
  lines: string[];
}

export function indexText(text: string): IndexedText {
  const sentences = splitSentences(text);
  return {
    original: text,
    sentences,
    normalizedSentences: sentences.map(normalize),
    normalizedAll: normalize(text),
    lines: splitLines(text),
  };
}

/** True when any of `terms` (already normalized) appears anywhere in the text. */
export function containsAny(index: IndexedText, terms: string[]): boolean {
  return terms.some((term) => index.normalizedAll.includes(term));
}

/**
 * The sentence a term actually appears in, in the document's own spelling.
 * Longest term first: when both "rescis" and "rescisão antecipada" would fire,
 * quote back the more specific line.
 */
export function quoteFor(index: IndexedText, terms: string[]): string | null {
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  for (const term of ordered) {
    const at = index.normalizedSentences.findIndex((s) => s.includes(term));
    if (at >= 0) return trimQuote(index.sentences[at]);
  }
  return null;
}

/** Every distinct sentence matching any term, capped, in document order. */
export function quotesFor(index: IndexedText, terms: string[], limit = 3): string[] {
  const quotes: string[] = [];
  for (let i = 0; i < index.sentences.length && quotes.length < limit; i += 1) {
    if (terms.some((term) => index.normalizedSentences[i].includes(term))) {
      const quote = trimQuote(index.sentences[i]);
      if (!quotes.includes(quote)) quotes.push(quote);
    }
  }
  return quotes;
}

/**
 * Parses a number written the Brazilian way ("1.234,56", "R$ 4.500,00",
 * "(1.200,00)" for negatives) or the US way ("1,234.56"). Returns null for
 * anything that is not unambiguously a number — a cell reading "N/A" or "Mar"
 * must not silently become 0 and drag a total with it.
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  const parenthesised = /^\(.*\)$/.test(value);
  value = value
    .replace(/^\(|\)$/g, '')
    .replace(/r\$|us\$|brl|usd|%/gi, '')
    .replace(/[\s\u00a0]/g, '');

  if (!/^-?[\d.,]+$/.test(value)) return null;
  if (!/\d/.test(value)) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    value = lastComma > lastDot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // A single comma is a decimal separator unless it is grouping thousands
    // ("1,234" / "12,345,678"), which is exactly 3 digits after each comma.
    const groupsAsThousands = /^-?\d{1,3}(,\d{3})+$/.test(value);
    value = groupsAsThousands ? value.replace(/,/g, '') : value.replace(',', '.');
  } else if (lastDot >= 0) {
    const groupsAsThousands = /^-?\d{1,3}(\.\d{3})+$/.test(value);
    if (groupsAsThousands) value = value.replace(/\./g, '');
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parenthesised ? -Math.abs(parsed) : parsed;
}

/** pt-BR money formatting — the only format a Brazilian owner reads without pausing. */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

/**
 * Words that carry no search signal. Kept small on purpose: over-filtering a
 * question is how you end up "answering" a question the user never asked.
 */
const STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'ele', 'em', 'essa',
  'esse', 'esta', 'este', 'eu', 'foi', 'for', 'isso', 'ja', 'la', 'mais', 'mas', 'me', 'meu',
  'minha', 'muito', 'na', 'nao', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por',
  'pra', 'qual', 'quais', 'quando', 'que', 'quem', 'se', 'sem', 'ser', 'seu', 'sua', 'tem', 'ter',
  'um', 'uma', 'voce', 'sobre', 'esse', 'aqui', 'esta', 'estao', 'sao', 'tudo', 'todo', 'toda',
  'preciso', 'quero', 'gostaria', 'saber', 'diga', 'diz', 'fale', 'me', 'analise', 'analisa',
  'documento', 'arquivo', 'contrato', 'texto', 'favor', 'onde', 'porque', 'devo', 'posso',
]);

/**
 * The searchable words of a question: 4+ characters, not a stopword, deduped.
 * These are what gets reported back as "procurei por X, Y e Z" when the
 * document says nothing about them.
 */
export function questionTerms(question: string): string[] {
  const words = normalize(question)
    .replace(/[^\p{L}\p{N}\s$%]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  return [...new Set(words)];
}

/** Joins a list the way Portuguese does: "a, b e c". */
export function joinPtBr(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

const MONEY_PATTERN = /R\$\s?-?\d[\d.,]*/gi;
const PERCENT_PATTERN = /-?\d+(?:[.,]\d+)?\s?%/g;
const DAYS_PATTERN = /\b(\d{1,4})\s*\(?[^()]{0,20}?\)?\s*dias?\b/gi;
const PERIOD_PATTERN = /\b(\d{1,3})\s*(semanas?|m[eê]s(?:es)?|anos?)\b/gi;
const DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

/** Every "R$ ..." amount in the text, as parsed numbers, in document order. */
export function moneyAmounts(text: string): number[] {
  return (text.match(MONEY_PATTERN) ?? [])
    .map((raw) => parseNumber(raw))
    .filter((value): value is number => value !== null);
}

/** The literal money strings, so the analysis can quote "R$ 4.500,00" verbatim. */
export function moneyLiterals(text: string): string[] {
  return [
    ...new Set(
      (text.match(MONEY_PATTERN) ?? [])
        // The pattern is greedy over `[\d.,]` so it swallows the comma that
        // ends the sentence — "R$ 38.000,00," must be quoted back as
        // "R$ 38.000,00" or the analysis looks like it cannot read its own output.
        .map((raw) => raw.replace(/\s+/g, ' ').replace(/[.,]+$/, '').trim()),
    ),
  ];
}

export function percentLiterals(text: string): string[] {
  return [...new Set((text.match(PERCENT_PATTERN) ?? []).map((raw) => raw.replace(/\s+/g, '').trim()))];
}

/** Day counts mentioned anywhere ("prazo de 30 dias" → 30). */
export function dayCounts(text: string): number[] {
  const counts: number[] = [];
  for (const match of text.matchAll(DAYS_PATTERN)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) counts.push(value);
  }
  return counts;
}

/** Longer durations, normalized to days so a vigência can be compared to a prazo. */
export function periodInDays(text: string): number[] {
  const days: number[] = [];
  for (const match of text.matchAll(PERIOD_PATTERN)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = normalize(match[2]);
    if (unit.startsWith('semana')) days.push(value * 7);
    else if (unit.startsWith('mes')) days.push(value * 30);
    else days.push(value * 365);
  }
  return days;
}

export function calendarDates(text: string): string[] {
  return [...new Set(text.match(DATE_PATTERN) ?? [])];
}
