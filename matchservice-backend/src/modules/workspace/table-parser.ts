import { formatMoney, normalize, parseNumber, splitLines } from './text-utils';

/**
 * A CSV/TSV export, parsed well enough to say true things about the numbers
 * in it.
 *
 * This is deliberately not a general spreadsheet engine. It answers the four
 * questions an owner actually asks of an export — how much in total, what are
 * the biggest lines, how concentrated is it, and how did it move over time —
 * and it refuses to answer at all when the file does not parse cleanly,
 * because a wrong total is far worse than no total.
 */

export interface ParsedTable {
  delimiter: string;
  header: string[];
  rows: string[][];
}

export interface NumericColumn {
  index: number;
  name: string;
  /** Parsed values aligned with `rows`; null where the cell was not a number. */
  values: Array<number | null>;
  /** Sum of the non-null values. */
  total: number;
  /** How many cells parsed as numbers. */
  count: number;
}

export interface TableEntry {
  label: string;
  value: number;
  /** Row index, so the caller can quote the original line. */
  rowIndex: number;
}

/**
 * Rows collapsed by label. This is the unit the business question is actually
 * about: "estou dependendo de um cliente só?" is answered by the client's
 * TOTAL across the file, not by its biggest single invoice. Reporting
 * concentration per row instead of per label is the single easiest way for a
 * spreadsheet analysis to be arithmetically correct and completely wrong.
 */
export interface TableGroup {
  label: string;
  value: number;
  /** How many rows collapsed into this group. */
  count: number;
}

export interface TableInsight {
  table: ParsedTable;
  /** The numeric column with the largest absolute total — the one that matters. */
  column: NumericColumn;
  labelColumnName: string | null;
  entries: TableEntry[];
  total: number;
  positiveTotal: number;
  negativeTotal: number;
  /** Individual rows sorted by absolute value, biggest first. */
  largest: TableEntry[];
  /** Labels with a positive total (revenue side), biggest first. */
  revenueGroups: TableGroup[];
  /** Labels with a negative total (cost side), biggest first by magnitude. */
  expenseGroups: TableGroup[];
  /** Share of all revenue held by the single biggest label, 0..100. */
  topRevenueShare: number;
  /** Share of all revenue held by the top three labels, 0..100. */
  topThreeRevenueShare: number;
  /** Share of all cost held by the single biggest cost label, 0..100. */
  topExpenseShare: number;
  /** Detected date/period column name, when the file has one. */
  periodColumnName: string | null;
  /** Totals per period ("2026-03" → 12345.6), only when a period column exists. */
  periodTotals: Array<{ period: string; total: number }>;
  /**
   * Rows that repeat the same label AND value inside the SAME period. Without
   * the period guard this fires on every monthly retainer in existence, which
   * would turn the most normal thing in a services P&L into a fake data bug.
   * Empty when the file has no period column — silence beats a false alarm.
   */
  duplicates: Array<{ label: string; value: number; times: number; period: string }>;
}

const CANDIDATE_DELIMITERS = [';', '\t', ',', '|'];
const MIN_DATA_ROWS = 2;

/**
 * Picks the delimiter that produces the most CONSISTENT column count across
 * the first lines — not the most frequent character. A Brazilian export uses
 * `;` precisely because the values contain `,` as a decimal separator, so
 * "count the commas" picks the wrong one every time.
 */
export function parseTable(text: string): ParsedTable | null {
  const lines = splitLines(text);
  if (lines.length < MIN_DATA_ROWS + 1) return null;

  const sample = lines.slice(0, 12);
  let best: { delimiter: string; columns: number; consistency: number } | null = null;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => splitRow(line, delimiter).length);
    const columns = counts[0];
    if (columns < 2) continue;
    const consistency = counts.filter((c) => c === columns).length / counts.length;
    if (consistency < 0.8) continue;
    if (!best || consistency > best.consistency || (consistency === best.consistency && columns > best.columns)) {
      best = { delimiter, columns, consistency };
    }
  }

  if (!best) return null;

  const header = splitRow(lines[0], best.delimiter);
  const rows = lines
    .slice(1)
    .map((line) => splitRow(line, best.delimiter))
    .filter((row) => row.length === header.length && row.some((cell) => cell.length > 0));

  if (rows.length < MIN_DATA_ROWS) return null;

  // A header row whose cells are all numbers is not a header — it is data, and
  // treating it as labels would silently drop the first record from the total.
  const headerLooksLikeData = header.every((cell) => parseNumber(cell) !== null);
  if (headerLooksLikeData) return null;

  return { delimiter: best.delimiter, header, rows };
}

/** Minimal quoted-CSV handling — enough for real exports, no more. */
function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

const NUMERIC_COLUMN_THRESHOLD = 0.6;
const DATE_CELL = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}-\d{2}(-\d{2})?$|^\d{4}\/\d{2}$/;
const PERIOD_HEADER = ['data', 'mes', 'periodo', 'competencia', 'vencimento', 'emissao', 'date', 'month'];
const VALUE_HEADER = ['valor', 'total', 'saldo', 'preco', 'receita', 'despesa', 'custo', 'montante', 'amount', 'value'];

export function analyzeTable(table: ParsedTable): TableInsight | null {
  const numericColumns = findNumericColumns(table);
  if (numericColumns.length === 0) return null;

  // Prefer a column the header itself names as a value column; fall back to
  // the one carrying the largest absolute total. A column of quantities
  // ("Qtd") should not out-rank a column of reais just because it parsed.
  const named = numericColumns.find((column) =>
    VALUE_HEADER.some((word) => normalize(column.name).includes(word)),
  );
  const column =
    named ??
    [...numericColumns].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0];

  const labelIndex = findLabelColumn(table, numericColumns);
  const periodIndex = findPeriodColumn(table, numericColumns);

  const entries: TableEntry[] = [];
  table.rows.forEach((row, rowIndex) => {
    const value = column.values[rowIndex];
    if (value === null) return;
    const label =
      labelIndex !== null && row[labelIndex] ? row[labelIndex] : `linha ${rowIndex + 2}`;
    entries.push({ label, value, rowIndex });
  });

  if (entries.length === 0) return null;

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const positiveTotal = entries.filter((e) => e.value > 0).reduce((s, e) => s + e.value, 0);
  const negativeTotal = entries.filter((e) => e.value < 0).reduce((s, e) => s + e.value, 0);

  const largest = [...entries].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const groups = groupByLabel(entries);
  const revenueGroups = groups.filter((group) => group.value > 0).sort((a, b) => b.value - a.value);
  const expenseGroups = groups.filter((group) => group.value < 0).sort((a, b) => a.value - b.value);

  const topRevenueShare =
    positiveTotal > 0 && revenueGroups.length ? (revenueGroups[0].value / positiveTotal) * 100 : 0;
  const topThreeRevenueShare =
    positiveTotal > 0
      ? (revenueGroups.slice(0, 3).reduce((sum, g) => sum + g.value, 0) / positiveTotal) * 100
      : 0;
  const topExpenseShare =
    negativeTotal < 0 && expenseGroups.length
      ? (Math.abs(expenseGroups[0].value) / Math.abs(negativeTotal)) * 100
      : 0;

  return {
    table,
    column,
    labelColumnName: labelIndex !== null ? table.header[labelIndex] : null,
    entries,
    total,
    positiveTotal,
    negativeTotal,
    largest,
    revenueGroups,
    expenseGroups,
    topRevenueShare,
    topThreeRevenueShare,
    topExpenseShare,
    periodColumnName: periodIndex !== null ? table.header[periodIndex] : null,
    periodTotals: periodIndex !== null ? totalsByPeriod(table, column, periodIndex) : [],
    duplicates: findDuplicates(table, column, labelIndex, periodIndex),
  };
}

function groupByLabel(entries: TableEntry[]): TableGroup[] {
  const groups = new Map<string, TableGroup>();
  for (const entry of entries) {
    const key = normalize(entry.label);
    const existing = groups.get(key);
    if (existing) {
      existing.value += entry.value;
      existing.count += 1;
    } else {
      groups.set(key, { label: entry.label, value: entry.value, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function findNumericColumns(table: ParsedTable): NumericColumn[] {
  const columns: NumericColumn[] = [];

  table.header.forEach((name, index) => {
    const values = table.rows.map((row) => parseNumber(row[index] ?? ''));
    const filled = table.rows.filter((row) => (row[index] ?? '').trim().length > 0).length;
    const parsed = values.filter((value) => value !== null).length;
    if (filled === 0 || parsed / filled < NUMERIC_COLUMN_THRESHOLD || parsed < MIN_DATA_ROWS) return;

    // A column of dates parses as numbers under some formats; exclude it
    // explicitly so "05/03/2026" never lands in a sum.
    const looksLikeDates = table.rows.filter((row) => DATE_CELL.test((row[index] ?? '').trim())).length;
    if (looksLikeDates > table.rows.length / 2) return;

    columns.push({
      index,
      name: name || `coluna ${index + 1}`,
      values,
      total: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      count: parsed,
    });
  });

  return columns;
}

/** The first mostly-textual column — what a human would read as the row's name. */
function findLabelColumn(table: ParsedTable, numericColumns: NumericColumn[]): number | null {
  const numericIndexes = new Set(numericColumns.map((c) => c.index));
  for (let index = 0; index < table.header.length; index += 1) {
    if (numericIndexes.has(index)) continue;
    const textual = table.rows.filter((row) => {
      const cell = (row[index] ?? '').trim();
      return cell.length > 0 && parseNumber(cell) === null && !DATE_CELL.test(cell);
    }).length;
    if (textual >= table.rows.length * 0.6) return index;
  }
  return null;
}

function findPeriodColumn(table: ParsedTable, numericColumns: NumericColumn[]): number | null {
  const numericIndexes = new Set(numericColumns.map((c) => c.index));
  for (let index = 0; index < table.header.length; index += 1) {
    const headerMatch = PERIOD_HEADER.some((word) => normalize(table.header[index] ?? '').includes(word));
    const dateCells = table.rows.filter((row) => DATE_CELL.test((row[index] ?? '').trim())).length;
    if (dateCells >= table.rows.length * 0.6) return index;
    if (headerMatch && !numericIndexes.has(index)) return index;
  }
  return null;
}

/** "05/03/2026" and "2026-03-05" both collapse to "03/2026". */
function periodKey(cell: string): string | null {
  const value = cell.trim();
  let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${match[2].padStart(2, '0')}/${year}`;
  }
  match = /^(\d{4})-(\d{2})/.exec(value);
  if (match) return `${match[2]}/${match[1]}`;
  match = /^(\d{4})\/(\d{2})$/.exec(value);
  if (match) return `${match[2]}/${match[1]}`;
  return value.length > 0 && value.length <= 12 ? value : null;
}

function totalsByPeriod(table: ParsedTable, column: NumericColumn, periodIndex: number) {
  const totals = new Map<string, number>();
  table.rows.forEach((row, rowIndex) => {
    const value = column.values[rowIndex];
    if (value === null) return;
    const key = periodKey(row[periodIndex] ?? '');
    if (!key) return;
    totals.set(key, (totals.get(key) ?? 0) + value);
  });

  return [...totals.entries()]
    .map(([period, total]) => ({ period, total }))
    .sort((a, b) => comparePeriods(a.period, b.period));
}

function comparePeriods(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^(\d{2})\/(\d{4})$/.exec(value);
    return match ? Number(match[2]) * 12 + Number(match[1]) : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (left !== null && right !== null) return left - right;
  return a.localeCompare(b);
}

function findDuplicates(
  table: ParsedTable,
  column: NumericColumn,
  labelIndex: number | null,
  periodIndex: number | null,
) {
  if (labelIndex === null || periodIndex === null) return [];

  const seen = new Map<string, { label: string; value: number; times: number; period: string }>();
  table.rows.forEach((row, rowIndex) => {
    const value = column.values[rowIndex];
    if (value === null) return;
    const period = periodKey(row[periodIndex] ?? '');
    if (!period) return;
    const label = row[labelIndex] ?? '';
    const key = `${normalize(label)}|${value}|${period}`;
    const existing = seen.get(key);
    if (existing) existing.times += 1;
    else seen.set(key, { label, value, times: 1, period });
  });

  return [...seen.values()].filter((row) => row.times > 1).sort((a, b) => b.times - a.times);
}

/** "R$ 12.480,00" for a positive, "-R$ 900,00" for a negative. */
export function money(value: number): string {
  return value < 0 ? `-R$ ${formatMoney(Math.abs(value))}` : `R$ ${formatMoney(value)}`;
}

/** Human name for the detected separator, so the analysis can state what it read. */
export function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case '\t':
      return 'tabulação';
    case ';':
      return 'ponto e vírgula';
    case ',':
      return 'vírgula';
    case '|':
      return 'barra vertical';
    default:
      return delimiter;
  }
}
