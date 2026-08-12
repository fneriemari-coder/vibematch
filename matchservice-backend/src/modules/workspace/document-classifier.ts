import { WorkspaceDocKind } from '@prisma/client';
import { normalize } from './text-utils';
import { parseTable } from './table-parser';

/**
 * Decides what a dropped file actually IS.
 *
 * The client never gets a say. A user renaming a P&L to "contrato.pdf" would
 * otherwise route the file to the clause analyser, which would then report a
 * missing penalty clause on a spreadsheet — confident, specific and wrong.
 *
 * Both halves vote: the filename (weak evidence, users are inconsistent) and
 * the content (strong evidence, the words a contract uses are not the words a
 * proposal uses). Content outweighs filename by design.
 */

interface KindSignals {
  kind: WorkspaceDocKind;
  /** Content fragments, normalized. Weight 3 each. */
  content: string[];
  /** Filename fragments, normalized. Weight 2 each. */
  filename: string[];
}

const SIGNALS: KindSignals[] = [
  {
    kind: WorkspaceDocKind.CONTRATO,
    content: [
      'contratante',
      'contratada',
      'contratado',
      'clausula',
      'pelo presente instrumento',
      'as partes',
      'firmam o presente',
      'de comum acordo',
      'foro da comarca',
      'rescis',
      'objeto do contrato',
      'partes acordam',
      'instrumento particular',
    ],
    filename: ['contrato', 'contract', 'acordo', 'termo', 'agreement', 'nda'],
  },
  {
    kind: WorkspaceDocKind.PROPOSTA,
    content: [
      'proposta comercial',
      'esta proposta',
      'validade da proposta',
      'escopo do projeto',
      'investimento',
      'orcamento',
      'apresentamos a seguir',
      'condicoes comerciais',
      'proposta valida',
    ],
    filename: ['proposta', 'orcamento', 'proposal', 'quote', 'budget'],
  },
  {
    kind: WorkspaceDocKind.FINANCEIRO,
    content: [
      'fluxo de caixa',
      'demonstrativo',
      'dre',
      'balancete',
      'receita bruta',
      'receita liquida',
      'lucro liquido',
      'margem de contribuicao',
      'contas a pagar',
      'contas a receber',
      'extrato',
      'faturamento',
      'despesas operacionais',
    ],
    filename: ['financeiro', 'dre', 'caixa', 'extrato', 'balanc', 'faturamento', 'receita', 'despesa'],
  },
  {
    kind: WorkspaceDocKind.RELATORIO,
    content: [
      'relatorio',
      'sumario executivo',
      'metodologia',
      'conclusao',
      'resultados obtidos',
      'periodo analisado',
      'indicadores',
    ],
    filename: ['relatorio', 'report', 'analise', 'resumo'],
  },
];

/**
 * Content signals score 3, filename signals 2. A file needs a clear winner to
 * get a specific kind: the spread between first and second place has to be at
 * least one content signal, otherwise it is OUTRO and the generic analyser —
 * which never asserts document-type-specific things — runs instead.
 */
const CONTENT_WEIGHT = 3;
const FILENAME_WEIGHT = 2;
const MIN_SCORE = 4;
const MIN_MARGIN = 2;

export function classifyDocument(
  filename: string,
  mimeType: string,
  text: string,
): WorkspaceDocKind {
  const normalizedName = normalize(filename);
  const normalizedText = normalize(text);

  const scores = SIGNALS.map((signal) => ({
    kind: signal.kind,
    score:
      signal.content.filter((term) => normalizedText.includes(term)).length * CONTENT_WEIGHT +
      signal.filename.filter((term) => normalizedName.includes(term)).length * FILENAME_WEIGHT,
  })).sort((a, b) => b.score - a.score);

  const tabular =
    mimeType === 'text/csv' ||
    /\.(csv|tsv|xlsx?|ods)$/i.test(filename) ||
    parseTable(text) !== null;

  const winner = scores[0];
  const runnerUp = scores[1];
  const decided =
    winner.score >= MIN_SCORE && winner.score - (runnerUp?.score ?? 0) >= MIN_MARGIN
      ? winner.kind
      : null;

  // A parseable table with financial vocabulary is FINANCEIRO (the numbers
  // mean money); a parseable table without it is PLANILHA (the numbers mean
  // something, and the analyser says so without claiming to know what).
  if (tabular) {
    return decided === WorkspaceDocKind.FINANCEIRO
      ? WorkspaceDocKind.FINANCEIRO
      : WorkspaceDocKind.PLANILHA;
  }

  return decided ?? WorkspaceDocKind.OUTRO;
}
