import { WorkspaceDocKind } from '@prisma/client';
import { MARKET_SKILL_TAGS } from '../diagnostics/growth-analyzer';
import { analyzeTable, delimiterLabel, money, parseTable, TableInsight } from './table-parser';
import {
  IndexedText,
  calendarDates,
  containsAny,
  dayCounts,
  formatMoney,
  formatPercent,
  indexText,
  joinPtBr,
  matchesTerm,
  moneyAmounts,
  moneyLiterals,
  normalize,
  percentLiterals,
  periodInDays,
  questionTerms,
  quoteFor,
  quotesFor,
  trimQuote,
} from './text-utils';

/**
 * The deterministic document analyser — the offline half of
 * `workspace.service.ts`, in the same spirit as `growth-analyzer.ts` is the
 * offline half of the growth diagnostic.
 *
 * This is NOT a placeholder and it is not the degraded path. `OPENAI_API_KEY`
 * is routinely absent from the environment this product is demonstrated in, so
 * this is the code that actually runs when a business owner drops their first
 * file in. It therefore has one non-negotiable rule: every sentence it emits
 * must be traceable to something in the user's own document — a clause that is
 * there, a clause that is not there, a number that was summed, a line that was
 * quoted. Where it has nothing to say, it says fewer things. It never pads.
 *
 * The most valuable output here is absence. Any tool can tell you that your
 * contract has a payment clause; the finding worth paying for is that it has
 * a payment obligation and no penalty for breaching it, no acceptance
 * criteria, and a scope that says "e demais serviços correlatos".
 */

export type FindingSeverity = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface AnalysisFinding {
  title: string;
  detail: string;
  severity: FindingSeverity;
}

export interface AnalyzedDocument {
  headline: string;
  summary: string;
  findings: AnalysisFinding[];
  risks: string[];
  actions: string[];
  suggestedSkills: string[];
}

export interface AnalyzerInput {
  filename: string;
  kind: WorkspaceDocKind;
  text: string;
  question: string;
}

const MAX_FINDINGS = 8;
const MAX_RISKS = 6;
const MAX_ACTIONS = 5;
const MAX_SKILLS = 5;
const SEVERITY_RANK: Record<FindingSeverity, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

/** Working accumulator. Findings are only added when something fired. */
interface Draft {
  findings: AnalysisFinding[];
  risks: string[];
  actions: string[];
  skills: string[];
}

function draft(): Draft {
  return { findings: [], risks: [], actions: [], skills: [] };
}

// ---------------------------------------------------------------------------
// Answering the question the user actually asked
// ---------------------------------------------------------------------------

interface QuestionTopic {
  label: string;
  triggers: string[];
  /** Everything we search the document for when this topic fires. */
  expand: string[];
}

/**
 * Question vocabulary → document vocabulary. Users ask "posso cancelar?"; the
 * contract says "resilição imotivada". Without this bridge the honest answer
 * ("não encontrei 'cancelar'") would be technically true and useless.
 */
const QUESTION_TOPICS: QuestionTopic[] = [
  {
    label: 'multa e penalidade',
    triggers: ['multa', 'penalidade', 'penaliza', 'punicao', 'punir', 'descumpr', 'proteg', 'protecao', 'atras', 'inadimpl', 'calote', 'seguranca juridica'],
    expand: ['multa', 'penalidade', 'clausula penal', 'mora', 'sancao', 'perdas e danos'],
  },
  {
    label: 'prazo',
    triggers: ['prazo', 'quanto tempo', 'cronograma', 'entrega', 'atras', 'vigencia', 'duracao'],
    expand: ['prazo', 'vigencia', 'cronograma', 'dias', 'entrega', 'ate o dia', 'inicio', 'termino'],
  },
  {
    label: 'pagamento',
    triggers: ['pagamento', 'pagar', 'valor', 'preco', 'custo', 'quanto', 'parcela', 'reais', 'cobran'],
    expand: ['pagamento', 'r$', 'valor', 'parcel', 'vencimento', 'honorari', 'nota fiscal', 'boleto', 'pix'],
  },
  {
    label: 'rescisão',
    triggers: ['rescis', 'cancelar', 'cancelamento', 'encerrar', 'sair', 'romper', 'desistir', 'terminar'],
    expand: ['rescis', 'resili', 'denuncia', 'aviso previo', 'distrato', 'termino antecipado', 'encerramento'],
  },
  {
    label: 'propriedade intelectual',
    triggers: ['propriedade', 'autoral', 'direitos', 'codigo', 'titularidade', 'quem fica'],
    expand: [
      'propriedade intelectual',
      'direitos autorais',
      'direito autoral',
      'cessao',
      'titularidade',
      'codigo-fonte',
      'codigo fonte',
      'licenca',
    ],
  },
  {
    label: 'exclusividade',
    triggers: ['exclusiv', 'concorren', 'competi'],
    expand: ['exclusiv', 'concorrenc', 'nao concorrencia', 'nao competicao'],
  },
  {
    label: 'confidencialidade',
    triggers: ['confidencial', 'sigilo', 'segredo', 'nda', 'vazar'],
    expand: ['confidencial', 'sigilo', 'nao divulgacao', 'informacoes reservadas'],
  },
  {
    label: 'reajuste',
    triggers: ['reajust', 'aumento', 'inflacao', 'indice', 'correcao'],
    expand: ['reajust', 'igp-m', 'igpm', 'ipca', 'inpc', 'correcao monetaria'],
  },
  {
    label: 'escopo',
    triggers: ['escopo', 'incluido', 'incluso', 'inclui', 'objeto', 'servico', 'entregav'],
    expand: ['escopo', 'objeto', 'compreende', 'inclui', 'sera realizado', 'atividades', 'entregav'],
  },
  {
    label: 'garantia',
    triggers: ['garantia', 'defeito', 'conserto', 'refazer', 'retrabalho'],
    expand: ['garantia', 'vicio', 'defeito', 'refaz', 'corrigir'],
  },
  {
    label: 'foro',
    triggers: ['foro', 'judicial', 'justica', 'processo', 'arbitrag', 'briga'],
    expand: ['foro', 'comarca', 'arbitrag', 'mediacao', 'jurisdicao'],
  },
  {
    label: 'concentração',
    triggers: ['concentr', 'depende', 'dependenc', 'maior cliente', 'principal cliente'],
    expand: ['cliente', 'receita', 'faturamento'],
  },
  {
    label: 'despesas',
    triggers: ['despesa', 'custo', 'gasto', 'saida', 'sangria', 'corte'],
    expand: ['despesa', 'custo', 'gasto', 'saida', 'pagamento'],
  },
];

/**
 * Phrases that mean "tell me what is missing" rather than naming a subject.
 * They are the most common way an owner opens this feature, and they deserve
 * a direct answer instead of a keyword search that finds nothing.
 */
const GAP_TRIGGERS = [
  'falta',
  'faltando',
  'faltou',
  'lacuna',
  'o que revisar',
  'revisar',
  'antes de assinar',
  'antes de enviar',
  'antes de mandar',
  'o que devo',
  'o que preciso',
  'o que esta errado',
  'o que melhorar',
  'esqueci',
  'esta completo',
  'esta faltando',
];

interface QuestionAnswer {
  topics: QuestionTopic[];
  /** The question asks what is missing, not about a named subject. */
  gapFocused: boolean;
  /** Topics the document actually says something about. */
  covered: QuestionTopic[];
  /** Topics whose entire vocabulary is absent from the document. */
  uncovered: QuestionTopic[];
  searched: string[];
  quotes: string[];
  /** Searched terms that appear nowhere in the document. */
  absent: string[];
  found: boolean;
}

/**
 * Triggers match at a word boundary, never as a bare substring. Plain
 * `includes` made "nda" fire inside "mandar" and routed a question about a
 * proposal to the confidentiality topic — the kind of wrong answer that is
 * delivered confidently and destroys trust in one read.
 */
function triggerFires(normalizedQuestion: string, trigger: string): boolean {
  return matchesTerm(normalizedQuestion, trigger);
}

function answerQuestion(index: IndexedText, question: string): QuestionAnswer {
  const normalizedQuestion = normalize(question);
  const topics = QUESTION_TOPICS.filter((topic) =>
    topic.triggers.some((trigger) => triggerFires(normalizedQuestion, trigger)),
  );
  const gapFocused = GAP_TRIGGERS.some((trigger) => triggerFires(normalizedQuestion, trigger));

  const fromTopics = topics.flatMap((topic) => topic.expand);
  const fromWords = questionTerms(question);
  const searched = [...new Set([...fromTopics, ...fromWords])];

  // Rank sentences by how many DISTINCT searched terms they carry: a line that
  // mentions both "multa" and "atraso" answers the question better than three
  // lines that each mention one.
  const scored = index.normalizedSentences
    .map((sentence, position) => ({
      position,
      hits: searched.filter((term) => matchesTerm(sentence, term)).length,
      length: sentence.length,
    }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.position - b.position);

  const quotes: string[] = [];
  for (const entry of scored) {
    if (quotes.length >= 3) break;
    const quote = trimQuote(index.sentences[entry.position]);
    if (!quotes.includes(quote)) quotes.push(quote);
  }

  const absent = searched.filter((term) => !matchesTerm(index.normalizedAll, term));

  // Split the topics the question raised into the ones the document answers
  // and the ones it is silent about. The split is what lets the summary lead
  // with a gap: a question about protection against late payment is answered
  // by the ABSENCE of a penalty clause, and burying that under the payment
  // clause we did find would be technically responsive and practically a lie.
  const covered = topics.filter((topic) => topic.expand.some((term) => matchesTerm(index.normalizedAll, term)));
  const uncovered = topics.filter((topic) => !covered.includes(topic));

  return { topics, gapFocused, covered, uncovered, searched, quotes, absent, found: quotes.length > 0 };
}

/**
 * The opening paragraph. It always leads with the user's own question, and
 * when the document says nothing about it, it says so first — before any
 * finding — and names the exact terms it looked for. "Não está no documento"
 * with evidence is an answer; changing the subject is not.
 */
function questionParagraph(
  index: IndexedText,
  question: string,
  answer: QuestionAnswer,
  charCount: number,
  /** What the caller's own pass found missing — used when the question is "o que falta?". */
  gaps: string[] = [],
): string {
  // "O que está faltando neste contrato?" names no subject to search for. The
  // honest answer is the gap list the analyser just produced, stated up front.
  if (answer.gapFocused && answer.topics.length === 0 && gaps.length > 0) {
    return (
      `Você perguntou o que está faltando. Respondendo direto, e só com o que a busca no texto sustenta: ` +
      `faltam ${joinPtBr(gaps)}. Nenhum desses pontos aparece em nenhuma das ${index.lines.length} linhas do arquivo — ` +
      'cada um foi verificado pelo vocabulário que a cláusula usaria, não por impressão de leitura.'
    );
  }

  const subject = answer.topics.length
    ? joinPtBr(answer.topics.map((topic) => topic.label))
    : `“${trimQuote(question, 160)}”`;
  const scale = `${index.lines.length} linhas e ${new Intl.NumberFormat('pt-BR').format(charCount)} caracteres`;

  // Case 1 — part of the question has no answer in the document. That gap goes
  // first, with the exact vocabulary that was searched, because it is the
  // finding the user cannot get anywhere else.
  if (answer.uncovered.length > 0) {
    const missing = joinPtBr(answer.uncovered.map((topic) => topic.label));
    const looked = joinPtBr(
      [...new Set(answer.uncovered.flatMap((topic) => topic.expand))].slice(0, 6).map((term) => `“${term}”`),
    );
    const opening =
      `Você perguntou sobre ${subject}, e a parte mais importante da resposta é uma ausência: ` +
      `o documento não diz nada sobre ${missing}. Procurei por ${looked} nas ${scale} do arquivo e ` +
      'nenhum desses termos aparece — não é interpretação, é busca no texto.';

    if (answer.covered.length && answer.quotes.length) {
      return (
        `${opening} Sobre ${joinPtBr(answer.covered.map((topic) => topic.label))} o documento fala, ` +
        `e o trecho é este: “${answer.quotes[0]}”. O desequilíbrio está aí: a obrigação está escrita, ` +
        'a proteção contra o descumprimento dela não está.'
      );
    }
    return `${opening} O que vier a acontecer nesse ponto não está regulado por este documento.`;
  }

  // Case 2 — the document answers, so quote it.
  if (answer.found) {
    const primary = answer.quotes[0];
    const secondary = answer.quotes[1];
    const extra = secondary ? ` O documento volta ao assunto em “${secondary}”.` : '';
    return (
      `Você perguntou sobre ${subject}. O documento trata disso, e o trecho que responde é este: ` +
      `“${primary}”.${extra}`
    );
  }

  // Case 3 — no topic matched and no sentence matched: report the words.
  const looked = answer.searched.slice(0, 6);
  const lookedText = looked.length ? `Procurei por ${joinPtBr(looked.map((t) => `“${t}”`))}` : 'Procurei';
  return (
    `Você perguntou sobre ${subject} — e a resposta é uma ausência, que é exatamente o que você precisa saber. ` +
    `${lookedText} nas ${scale} do arquivo, e nenhum desses termos aparece. ` +
    'Este documento não trata do assunto: o que vier a acontecer nesse ponto não está regulado por ele.'
  );
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

interface ContractContext {
  index: IndexedText;
  moneyLiterals: string[];
  percents: string[];
  days: number[];
  longestPeriodDays: number;
  dates: string[];
  hasPayment: boolean;
  hasDeliverables: boolean;
  isRecurring: boolean;
  isIntellectualWork: boolean;
  charCount: number;
}

interface ClauseSpec {
  key: string;
  /** How the clause is named back to the user, in the middle of a sentence. */
  label: string;
  terms: string[];
  presence?: {
    severity: FindingSeverity;
    title: string;
    detail: (quote: string, ctx: ContractContext) => string;
  };
  absence?: {
    severity: FindingSeverity;
    title: string;
    detail: string;
    risk: string;
    action: string;
    skills: string[];
    /** The absence is only a finding when the document is the kind that needs it. */
    onlyWhen?: (ctx: ContractContext) => boolean;
    /** Raises severity to ALTA when the document makes the gap expensive. */
    escalateWhen?: (ctx: ContractContext) => boolean;
  };
}

const CLAUSES: ClauseSpec[] = [
  {
    key: 'pagamento',
    label: 'condições de pagamento',
    terms: ['pagamento', 'pagar', 'remunera', 'honorari', 'valor total', 'parcel', 'boleto', 'vencimento', 'nota fiscal'],
    presence: {
      severity: 'BAIXA',
      title: 'Condições de pagamento',
      detail: (quote, ctx) => {
        const values = ctx.moneyLiterals.slice(0, 3);
        const amounts = values.length
          ? ` Os valores que aparecem no documento são ${joinPtBr(values)}.`
          : ' O documento fala em pagamento mas não escreve nenhum valor em reais — isso é uma lacuna, não um detalhe.';
        return `“${quote}”.${amounts}`;
      },
    },
    absence: {
      severity: 'ALTA',
      title: 'Sem condição de pagamento definida',
      detail:
        'Não há nenhuma cláusula que diga quanto se paga, quando se paga e contra o quê. Um contrato de serviço sem isso ' +
        'transfere a definição do preço para a conversa que vier depois — normalmente a conversa em que uma das partes já ' +
        'entregou e a outra ainda não pagou.',
      risk: 'O contrato cria obrigação de fazer sem fixar a obrigação de pagar: qualquer cobrança depende de acordo posterior.',
      action: 'Incluir cláusula com valor, forma de pagamento, data de vencimento e o marco que dispara cada parcela.',
      skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
    },
  },
  {
    key: 'prazo',
    label: 'prazo de execução',
    terms: ['prazo', 'vigencia', 'vigor', 'cronograma', 'ate o dia', 'dias uteis', 'data de inicio', 'duracao', 'entrega em'],
    presence: {
      severity: 'BAIXA',
      title: 'Prazo declarado',
      detail: (quote, ctx) => {
        const days = ctx.days.length ? ` Os prazos citados são de ${joinPtBr(ctx.days.slice(0, 3).map((d) => `${d} dias`))}.` : '';
        const anchor = containsAny(ctx.index, ['a contar', 'a partir da', 'contados da', 'apos a assinatura'])
          ? ''
          : ' O documento não diz a partir de qual evento esse prazo começa a correr, o que torna qualquer atraso discutível.';
        return `“${quote}”.${days}${anchor}`;
      },
    },
    absence: {
      severity: 'ALTA',
      title: 'Sem prazo de execução',
      detail:
        'Nenhuma cláusula fixa prazo, data de entrega ou vigência. Sem prazo não existe atraso — e sem atraso não existe ' +
        'inadimplemento a alegar, por nenhum dos dois lados.',
      risk: 'Entrega sem data: nada obriga a contratada a terminar, e nada protege a contratada de cobrança a qualquer momento.',
      action: 'Fixar data de início, prazo de execução em dias (úteis ou corridos, escrito) e o evento que dispara a contagem.',
      skills: ['CONTROLLER', 'STARTUPS'],
    },
  },
  {
    key: 'multa',
    label: 'multa por descumprimento',
    terms: ['multa', 'penalidade', 'clausula penal', 'juros de mora', 'mora', 'sancao', 'perdas e danos'],
    presence: {
      severity: 'BAIXA',
      title: 'Penalidade prevista',
      detail: (quote, ctx) => {
        const rates = ctx.percents.slice(0, 3);
        const rateText = rates.length ? ` Percentuais citados: ${joinPtBr(rates)}.` : '';
        return `“${quote}”.${rateText}`;
      },
    },
    absence: {
      severity: 'ALTA',
      title: 'Sem cláusula de multa',
      detail:
        'O documento cria obrigações mas não estabelece nenhuma consequência para quem as descumprir: não há multa, ' +
        'cláusula penal, juros de mora nem previsão de perdas e danos. Na prática, atrasar a entrega e atrasar o ' +
        'pagamento custam a mesma coisa neste contrato — nada — e a única saída para quem for prejudicado é discutir ' +
        'prejuízo em juízo, provando o dano item a item.',
      risk: 'Descumprir este contrato não tem preço definido, então cumprir na data é uma escolha de cada parte, não uma obrigação com custo.',
      action:
        'Inserir cláusula penal: multa por atraso na entrega (percentual por dia sobre o valor da parcela, com teto) e multa + juros de mora por atraso no pagamento.',
      skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
      escalateWhen: (ctx) => ctx.hasPayment,
    },
  },
  {
    key: 'rescisao',
    label: 'rescisão',
    terms: ['rescis', 'resili', 'denuncia', 'aviso previo', 'distrato', 'termino antecipado', 'encerramento do contrato'],
    presence: {
      severity: 'BAIXA',
      title: 'Rescisão prevista',
      detail: (quote) => `“${quote}”.`,
    },
    absence: {
      severity: 'ALTA',
      title: 'Sem cláusula de rescisão',
      detail:
        'Não há nada sobre como sair deste contrato: nem prazo de aviso prévio, nem hipóteses de rescisão por justa ' +
        'causa, nem o que acontece com o trabalho já executado e ainda não pago quando alguém quiser encerrar.',
      risk: 'Qualquer das partes pode simplesmente parar, e o acerto do que já foi feito vira negociação sem regra.',
      action:
        'Definir aviso prévio (por exemplo 30 dias), as hipóteses de rescisão imediata por justa causa e como se apura o que já foi entregue mas não pago.',
      skills: ['CONTROLLER', 'STARTUPS'],
    },
  },
  {
    key: 'escopo_delimitado',
    label: 'delimitação do escopo',
    terms: [
      'nao esta incluido',
      'nao incluso',
      'nao inclui',
      'fora do escopo',
      'exclui-se',
      'excluidos',
      'limita-se a',
      'restringe-se a',
      'nao compreende',
      'nao abrange',
    ],
    presence: {
      severity: 'BAIXA',
      title: 'Escopo com fronteira explícita',
      detail: (quote) => `O contrato diz o que NÃO está incluído, que é a metade que quase todo contrato esquece: “${quote}”.`,
    },
    absence: {
      severity: 'ALTA',
      title: 'Escopo sem fronteira',
      detail:
        'O documento descreve o que será feito, mas em nenhum ponto diz o que NÃO está incluído. Essa é a lacuna que ' +
        'produz o conflito mais comum em prestação de serviço: cada pedido adicional parece razoável isoladamente, ' +
        'nenhum deles tem preço, e a soma consome a margem inteira do trabalho.',
      risk: 'Sem lista de exclusões, todo pedido novo é interpretado como parte do combinado — e recusar vira problema de relacionamento, não de contrato.',
      action:
        'Acrescentar uma lista curta de exclusões ("não estão incluídos: X, Y, Z") e a regra de que qualquer item fora dela é orçado à parte por termo aditivo.',
      skills: ['CONTROLLER', 'STARTUPS'],
      onlyWhen: (ctx) => ctx.hasDeliverables,
    },
  },
  {
    key: 'aceite',
    label: 'critério de aceite',
    terms: ['aceite', 'homologa', 'aprovacao formal', 'criterio de aceitacao', 'validacao da entrega', 'termo de recebimento', 'conferencia'],
    presence: {
      severity: 'BAIXA',
      title: 'Critério de aceite definido',
      detail: (quote) => `“${quote}”.`,
    },
    absence: {
      severity: 'MEDIA',
      title: 'Sem critério de aceite',
      detail:
        'Não há definição de quando a entrega está aceita: nem prazo para o contratante conferir, nem o que acontece ' +
        'se ele não se manifestar. Sem isso, "pronto" é uma opinião, e a parcela final fica presa numa aprovação que ' +
        'pode nunca chegar.',
      risk: 'A última parcela depende de um aceite que ninguém é obrigado a dar em prazo nenhum.',
      action:
        'Definir aceite tácito: o contratante tem N dias úteis para apontar divergências por escrito; passado o prazo sem manifestação, a entrega é considerada aceita.',
      skills: ['CONTROLLER', 'STARTUPS'],
      escalateWhen: (ctx) => ctx.hasPayment && ctx.hasDeliverables,
    },
  },
  {
    key: 'revisoes',
    label: 'limite de revisões',
    terms: ['revisao', 'revisoes', 'alteracao de escopo', 'aditivo', 'rodada de ajustes', 'rodadas de'],
    absence: {
      severity: 'MEDIA',
      title: 'Revisões sem limite',
      detail:
        'O contrato não fixa quantas rodadas de ajuste estão incluídas nem como se cobra a partir da próxima. Em ' +
        'trabalho criativo ou técnico é a cláusula que separa um projeto que fecha de um projeto que se arrasta.',
      risk: 'Número ilimitado de revisões dentro do mesmo preço: o custo real da entrega é decidido pelo humor do cliente.',
      action: 'Estabelecer o número de rodadas de revisão incluídas e o valor da hora (ou da rodada) excedente.',
      skills: ['CONTROLLER', 'DESIGN'],
      onlyWhen: (ctx) => ctx.isIntellectualWork,
    },
  },
  {
    key: 'propriedade_intelectual',
    label: 'propriedade intelectual',
    terms: ['propriedade intelectual', 'direitos autorais', 'direito autoral', 'cessao de direitos', 'titularidade', 'codigo-fonte', 'codigo fonte', 'licenca de uso'],
    presence: {
      severity: 'MEDIA',
      title: 'Transferência de direitos',
      detail: (quote) =>
        `Este contrato move a titularidade do que for produzido: “${quote}”. Confira se a transferência está condicionada ao ` +
        'pagamento integral — cessão que ocorre na entrega, e não na quitação, entrega o ativo antes de receber por ele.',
    },
    absence: {
      severity: 'MEDIA',
      title: 'Propriedade do resultado indefinida',
      detail:
        'O contrato não diz de quem é o que for produzido — arquivos, código, textos, criações. Sem cláusula, a ' +
        'titularidade segue a regra legal geral, que quase nunca é a que as duas partes imaginam ter combinado.',
      risk: 'Disputa sobre quem pode usar, revender ou publicar o resultado, descoberta depois da entrega.',
      action: 'Escrever a quem pertence o resultado, a partir de quando (pagamento integral) e o que cada parte pode usar como portfólio.',
      skills: ['CONTROLLER', 'STARTUPS'],
      onlyWhen: (ctx) => ctx.isIntellectualWork,
      escalateWhen: (ctx) => ctx.isIntellectualWork && ctx.hasPayment,
    },
  },
  {
    key: 'confidencialidade',
    label: 'confidencialidade',
    terms: ['confidencial', 'sigilo', 'nao divulgacao', 'informacoes reservadas'],
    absence: {
      severity: 'MEDIA',
      title: 'Sem cláusula de confidencialidade',
      detail:
        'Nada no documento obriga as partes a guardar sigilo sobre dados, preços, base de clientes ou métodos aos ' +
        'quais tiverem acesso durante o trabalho.',
      risk: 'Informação sensível trocada durante o projeto circula sem obrigação de sigilo.',
      action: 'Inserir cláusula de confidencialidade com prazo de sobrevivência após o fim do contrato (2 a 5 anos é o usual).',
      skills: ['CONTROLLER'],
    },
  },
  {
    key: 'reajuste',
    label: 'reajuste',
    terms: ['reajust', 'igp-m', 'igpm', 'ipca', 'inpc', 'correcao monetaria'],
    absence: {
      severity: 'MEDIA',
      title: 'Contrato recorrente sem reajuste',
      detail:
        'O contrato tem caráter continuado mas não prevê índice nem periodicidade de reajuste. Um valor fixo por ' +
        'tempo indeterminado é uma perda silenciosa: o preço fica igual enquanto o custo não fica.',
      risk: 'Erosão da margem pela inflação, sem gatilho contratual para corrigir.',
      action: 'Fixar índice (IPCA ou IGP-M) e periodicidade anual de reajuste automático.',
      skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
      onlyWhen: (ctx) => ctx.isRecurring || ctx.longestPeriodDays >= 365,
    },
  },
  {
    key: 'limitacao_responsabilidade',
    label: 'limitação de responsabilidade',
    terms: ['limitacao de responsabilidade', 'limite de responsabilidade', 'responsabilidade limitada', 'indeniza'],
    absence: {
      severity: 'MEDIA',
      title: 'Responsabilidade sem teto',
      detail:
        'Não há limite para o valor que uma parte pode ser obrigada a indenizar a outra. Em um contrato pequeno, ' +
        'isso significa que uma falha pode custar muitas vezes o valor recebido pelo serviço.',
      risk: 'Exposição desproporcional ao tamanho do contrato: o prejuízo possível não guarda relação com o valor contratado.',
      action: 'Limitar a responsabilidade total ao valor efetivamente pago no contrato (ou nos últimos 12 meses, em contratos contínuos).',
      skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
    },
  },
  {
    key: 'foro',
    label: 'foro',
    terms: ['foro', 'comarca', 'arbitrag', 'mediacao', 'jurisdicao'],
    absence: {
      severity: 'BAIXA',
      title: 'Sem eleição de foro',
      detail: 'O documento não elege foro nem prevê mediação/arbitragem, então qualquer disputa começa discutindo onde discutir.',
      risk: 'Conflito resolvido em foro definido pela regra geral, possivelmente longe de quem precisa acionar.',
      action: 'Eleger o foro da comarca da parte com menos estrutura para litigar longe, ou prever mediação prévia.',
      skills: ['CONTROLLER'],
    },
  },
  {
    key: 'exclusividade',
    label: 'exclusividade',
    terms: ['exclusiv'],
    presence: {
      severity: 'MEDIA',
      title: 'Cláusula de exclusividade',
      detail: (quote) =>
        `“${quote}”. Exclusividade é uma restrição de faturamento: só se sustenta se vier com contrapartida — volume mínimo ` +
        'garantido, valor maior ou prazo curto. Verifique qual das três está escrita aqui.',
    },
  },
  {
    key: 'renovacao_automatica',
    label: 'renovação automática',
    terms: ['renovacao automatica', 'renovado automaticamente', 'prorrogado automaticamente', 'prorrogacao automatica', 'tacita reconducao'],
    presence: {
      severity: 'MEDIA',
      title: 'Renovação automática',
      detail: (quote) =>
        `“${quote}”. Renovação automática só é neutra quando existe janela clara de não-renovação; confira se o documento diz ` +
        'com quantos dias de antecedência é preciso avisar, e o que acontece se ninguém avisar.',
    },
  },
];

/** Language that shifts risk to one side. Each hit is checked against the text as written. */
interface AdverseSpec {
  terms: string[];
  severity: FindingSeverity;
  title: string;
  detail: (quote: string) => string;
  risk: string;
  action: string;
  skills: string[];
}

const ADVERSE_LANGUAGE: AdverseSpec[] = [
  {
    terms: ['a qualquer tempo', 'a qualquer momento'],
    severity: 'ALTA',
    title: 'Rescisão ou alteração a qualquer tempo',
    detail: (quote) =>
      `“${quote}”. Uma faculdade exercível "a qualquer tempo" sem aviso prévio e sem indenização transforma o contrato em ` +
      'uma promessa unilateral: quem investe em equipe ou insumo para atender não tem horizonte nenhum.',
    risk: 'A contraparte pode encerrar ou mudar o combinado sem prazo e sem custo.',
    action: 'Condicionar a faculdade a aviso prévio por escrito e ao pagamento do que já foi executado.',
    skills: ['CONTROLLER'],
  },
  {
    terms: ['a criterio exclusivo', 'a exclusivo criterio', 'a seu exclusivo criterio', 'a seu criterio'],
    severity: 'ALTA',
    title: 'Decisão unilateral',
    detail: (quote) =>
      `“${quote}”. Critério exclusivo de uma das partes sobre algo que afeta a outra é, na prática, ausência de regra: ` +
      'a obrigação existe, mas quem define se ela foi cumprida é a parte interessada.',
    risk: 'Uma das partes julga o cumprimento da própria contraparte, sem parâmetro objetivo.',
    action: 'Substituir "a critério exclusivo" por critérios objetivos e verificáveis, escritos no contrato.',
    skills: ['CONTROLLER'],
  },
  {
    terms: ['sem aviso previo', 'independentemente de aviso', 'independente de notificacao'],
    severity: 'ALTA',
    title: 'Efeito sem aviso prévio',
    detail: (quote) => `“${quote}”. Efeito imediato sem notificação remove a chance de corrigir o problema antes da consequência.`,
    risk: 'Consequência aplicada antes de qualquer oportunidade de correção.',
    action: 'Exigir notificação por escrito e prazo de cura (5 a 15 dias) antes de qualquer efeito.',
    skills: ['CONTROLLER'],
  },
  {
    terms: ['nao havera devolucao', 'nao reembolsavel', 'nao sera devolvido', 'nao sera restituido'],
    severity: 'MEDIA',
    title: 'Valores não reembolsáveis',
    detail: (quote) => `“${quote}”. Confira se essa regra vale também quando a interrupção não é culpa de quem pagou.`,
    risk: 'Pagamento retido mesmo em cenário de interrupção não causada por quem pagou.',
    action: 'Ressalvar a devolução proporcional quando a interrupção decorrer da outra parte ou de caso fortuito.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
];

/** Words that make a scope unenforceable. This is the single most common defect in BR service contracts. */
const VAGUE_SCOPE_TERMS = [
  'conforme necessario',
  'conforme a necessidade',
  'conforme demanda',
  'sob demanda',
  'a combinar',
  'a definir',
  'a ser definido',
  'entre outros',
  'entre outras',
  'etc',
  'demais servicos',
  'demais atividades',
  'servicos correlatos',
  'o que for necessario',
  'sempre que solicitado',
  'quando solicitado',
  'ilimitad',
  'melhorias continuas',
  'ajustes necessarios',
  'apoio geral',
  'suporte geral',
];

function contractContext(index: IndexedText, charCount: number): ContractContext {
  const text = index.original;
  const periods = periodInDays(text);
  return {
    index,
    moneyLiterals: moneyLiterals(text),
    percents: percentLiterals(text),
    days: [...new Set(dayCounts(text))].sort((a, b) => a - b),
    longestPeriodDays: periods.length ? Math.max(...periods) : 0,
    dates: calendarDates(text),
    hasPayment: containsAny(index, ['pagamento', 'pagar', 'r$', 'honorari', 'remunera', 'valor']),
    hasDeliverables: containsAny(index, [
      'objeto',
      'escopo',
      'servico',
      'entrega',
      'executar',
      'realizar',
      'desenvolv',
      'implanta',
    ]),
    isRecurring: containsAny(index, [
      'mensal',
      'mensalidade',
      'por mes',
      'recorrente',
      'continuad',
      'prazo indeterminado',
      'assinatura mensal',
    ]),
    isIntellectualWork: containsAny(index, [
      'software',
      'sistema',
      'codigo',
      'design',
      'layout',
      'conteudo',
      'campanha',
      'site',
      'aplicativo',
      'consultoria',
      'projeto',
      'criacao',
      'peca',
      'video',
    ]),
    charCount,
  };
}

function analyzeContract(input: AnalyzerInput, index: IndexedText, answer: QuestionAnswer): AnalyzedDocument {
  const ctx = contractContext(index, input.text.length);
  const out = draft();

  const present: ClauseSpec[] = [];
  const absent: ClauseSpec[] = [];

  for (const clause of CLAUSES) {
    const quote = quoteFor(index, clause.terms);
    if (quote) {
      present.push(clause);
      if (clause.presence) {
        out.findings.push({
          title: clause.presence.title,
          detail: clause.presence.detail(quote, ctx),
          severity: clause.presence.severity,
        });
      }
      continue;
    }

    if (!clause.absence) continue;
    if (clause.absence.onlyWhen && !clause.absence.onlyWhen(ctx)) continue;

    absent.push(clause);
    const severity =
      clause.absence.escalateWhen && clause.absence.escalateWhen(ctx) ? 'ALTA' : clause.absence.severity;
    out.findings.push({ title: clause.absence.title, detail: clause.absence.detail, severity });
    out.risks.push(clause.absence.risk);
    out.actions.push(clause.absence.action);
    out.skills.push(...clause.absence.skills);
  }

  for (const adverse of ADVERSE_LANGUAGE) {
    const quote = quoteFor(index, adverse.terms);
    if (!quote) continue;
    out.findings.push({ title: adverse.title, detail: adverse.detail(quote), severity: adverse.severity });
    out.risks.push(adverse.risk);
    out.actions.push(adverse.action);
    out.skills.push(...adverse.skills);
  }

  const vagueQuotes = quotesFor(index, VAGUE_SCOPE_TERMS, 3);
  if (vagueQuotes.length > 0) {
    out.findings.push({
      title: 'Escopo redigido em termos abertos',
      detail:
        `${vagueQuotes.length === 1 ? 'Um trecho define' : `${vagueQuotes.length} trechos definem`} a obrigação com ` +
        `expressões que não delimitam nada: ${joinPtBr(vagueQuotes.map((q) => `“${q}”`))}. ` +
        'Redação aberta é a forma mais cara de gentileza contratual: ela não gera conflito na assinatura, gera na terceira ' +
        'solicitação extra, quando já não dá para dizer não sem parecer má vontade.',
      severity: 'ALTA',
    });
    out.risks.push('Trechos de escopo redigidos de forma aberta permitem exigir trabalho não orçado sem sair do contrato.');
    out.actions.push(
      'Reescrever cada trecho aberto em obrigação contável (quantas peças, quantas visitas, quantas horas, com que frequência).',
    );
    out.skills.push('CONTROLLER', 'STARTUPS');
  }

  const summary = buildContractSummary(input, ctx, answer, present, absent, out);
  const headline = buildHeadline(documentLabel(input.kind, ctx), out.findings);

  return finalize(headline, summary, out);
}

function buildContractSummary(
  input: AnalyzerInput,
  ctx: ContractContext,
  answer: QuestionAnswer,
  present: ClauseSpec[],
  absent: ClauseSpec[],
  out: Draft,
): string {
  const paragraphs: string[] = [
    questionParagraph(
      ctx.index,
      input.question,
      answer,
      ctx.charCount,
      absent.map((clause) => clause.label),
    ),
  ];

  // What the document is, in its own numbers.
  const facts: string[] = [];
  if (ctx.moneyLiterals.length) facts.push(`valores de ${joinPtBr(ctx.moneyLiterals.slice(0, 3))}`);
  if (ctx.days.length) facts.push(`prazos de ${joinPtBr(ctx.days.slice(0, 3).map((d) => `${d} dias`))}`);
  if (ctx.percents.length) facts.push(`percentuais de ${joinPtBr(ctx.percents.slice(0, 3))}`);
  if (ctx.dates.length) facts.push(`datas em ${joinPtBr(ctx.dates.slice(0, 2))}`);

  const parties = detectParties(ctx.index);
  const partyText = parties.length >= 2 ? ` entre ${joinPtBr(parties)}` : '';
  paragraphs.push(
    `O arquivo “${input.filename}” é um contrato${partyText}, com ${ctx.index.lines.length} linhas úteis` +
      (facts.length ? `, ${joinPtBr(facts)}.` : '.') +
      (present.length
        ? ` Ele cobre ${joinPtBr(present.slice(0, 5).map((clause) => clause.label))}.`
        : ' Nenhuma das cláusulas que um contrato de serviço costuma ter foi encontrada.'),
  );

  // The gaps — the part a generic tool never writes.
  const gapsAlreadyStated = answer.gapFocused && answer.topics.length === 0 && absent.length > 0;
  const criticalGaps = absent.filter(
    (clause) => clause.absence && (clause.absence.severity === 'ALTA' || clause.absence.escalateWhen?.(ctx)),
  );
  if (criticalGaps.length && !gapsAlreadyStated) {
    paragraphs.push(
      `O que mais pesa aqui não é o que está escrito, é o que não está. Faltam ${joinPtBr(
        criticalGaps.map((clause) => clause.label),
      )}. ` +
        `Repare no encadeamento: ${gapMechanism(criticalGaps, ctx)}`,
    );
  } else if (criticalGaps.length) {
    // The gaps were already named up front; explain why they compound instead
    // of listing them a second time.
    paragraphs.push(`Repare no encadeamento: ${gapMechanism(criticalGaps, ctx)}`);
  } else if (absent.length) {
    paragraphs.push(
      `As cláusulas essenciais estão presentes. As lacunas restantes são de segunda ordem — ${joinPtBr(
        absent.map((clause) => clause.label),
      )} — e valem a correção na próxima renovação, não uma renegociação agora.`,
    );
  }

  if (out.actions.length) {
    paragraphs.push(
      `Se for para mexer em um ponto só antes de assinar, é este: ${out.actions[0]}`,
    );
  }

  return paragraphs.join('\n\n');
}

/**
 * Explains why the gaps compound instead of listing them again. This is the
 * paragraph that separates analysis from a checklist: the value is in the
 * causal chain between two absences, not in either absence alone.
 */
function gapMechanism(gaps: ClauseSpec[], ctx: ContractContext): string {
  const keys = new Set(gaps.map((clause) => clause.key));

  if (keys.has('multa') && ctx.hasPayment) {
    return (
      'o contrato fixa quanto se paga, mas não fixa o que acontece se não se pagar — a obrigação de dinheiro é ' +
      'precisa e a consequência do descumprimento é zero. É a combinação mais desequilibrada possível: quem ' +
      'entrega assume risco datado, quem paga assume risco nenhum.'
    );
  }
  if (keys.has('escopo_delimitado') && keys.has('aceite')) {
    return (
      'sem fronteira de escopo e sem critério de aceite, não existe momento em que o trabalho esteja "terminado". ' +
      'Uma coisa alimenta a outra: pedidos novos entram porque nada os exclui, e a entrega nunca fecha porque nada ' +
      'define o que é entregue.'
    );
  }
  if (keys.has('rescisao') && keys.has('prazo')) {
    return (
      'não há data para terminar nem forma de encerrar. O contrato só acaba quando as duas partes concordarem que ' +
      'acabou, o que é exatamente o cenário em que elas já não concordam.'
    );
  }
  return (
    'cada uma dessas ausências parece pequena isolada, mas elas se cobrem: a falta de uma tira o remédio que a ' +
    'outra exigiria. Corrigir só a mais visível não muda o resultado prático.'
  );
}

function detectParties(index: IndexedText): string[] {
  const found: string[] = [];
  const candidates: Array<[string, string]> = [
    ['contratante', 'CONTRATANTE'],
    ['contratada', 'CONTRATADA'],
    ['contratado', 'CONTRATADO'],
    ['locador', 'LOCADOR'],
    ['locatario', 'LOCATÁRIO'],
    ['prestador', 'PRESTADOR'],
    ['cliente', 'CLIENTE'],
  ];
  for (const [term, label] of candidates) {
    if (index.normalizedAll.includes(term) && !found.includes(label)) found.push(label);
    if (found.length === 2) break;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Financial documents and spreadsheet exports
// ---------------------------------------------------------------------------

/**
 * Revenue concentration thresholds. 30% in one client is the line at which a
 * services business stops being a business and starts being an employee with
 * extra steps; 20% is where it becomes worth naming.
 */
const CONCENTRATION_HIGH = 30;
const CONCENTRATION_MEDIUM = 20;

function analyzeFinancial(input: AnalyzerInput, index: IndexedText, answer: QuestionAnswer): AnalyzedDocument {
  const out = draft();
  const table = parseTable(input.text);
  const insight = table ? analyzeTable(table) : null;
  const paragraphs: string[] = [];

  if (insight) {
    // A spreadsheet has no sentences worth quoting — its header row is not an
    // answer to anything. So the question is answered from the numbers.
    paragraphs.push(tableQuestionParagraph(input, answer, insight));
    addTableFindings(insight, out);
    paragraphs.push(...tableSummary(input, insight));
  } else {
    paragraphs.push(questionParagraph(index, input.question, answer, input.text.length));
    paragraphs.push(...analyzeLooseAmounts(index, out));
  }

  if (out.actions.length) {
    paragraphs.push(`O primeiro movimento é objetivo: ${out.actions[0]}`);
  }

  const label = insight
    ? `${input.kind === WorkspaceDocKind.FINANCEIRO ? 'Financeiro' : 'Planilha'} — ${insight.entries.length} lançamentos, ${money(insight.total)}`
    : input.kind === WorkspaceDocKind.FINANCEIRO
      ? 'Documento financeiro'
      : 'Planilha';

  return finalize(buildHeadline(label, out.findings), paragraphs.join('\n\n'), out);
}

/**
 * Answers the question with arithmetic instead of a quote. Each branch is a
 * question an owner actually types at a spreadsheet, answered with the number
 * that settles it.
 */
function tableQuestionParagraph(
  input: AnalyzerInput,
  answer: QuestionAnswer,
  insight: TableInsight,
): string {
  const topics = new Set(answer.topics.map((topic) => topic.label));
  const asked = answer.topics.length ? joinPtBr(answer.topics.map((t) => t.label)) : `“${trimQuote(input.question, 160)}”`;
  const parts: string[] = [`Você perguntou sobre ${asked}. Respondendo com os números do próprio arquivo:`];

  if (topics.has('concentração') || topics.has('escopo') === false) {
    const top = insight.revenueGroups[0];
    if (top && insight.positiveTotal > 0) {
      parts.push(
        `“${top.label}” soma ${money(top.value)} em ${top.count} lançamento(s), ` +
          `${formatPercent(insight.topRevenueShare)} de toda a entrada do arquivo (${money(insight.positiveTotal)}). ` +
          `Os três maiores juntos são ${formatPercent(insight.topThreeRevenueShare)}.`,
      );
    }
  }

  if (topics.has('despesas')) {
    const worst = insight.expenseGroups[0];
    if (worst) {
      parts.push(
        `Do lado das saídas, “${worst.label}” é a maior: ${money(worst.value)}, ` +
          `${formatPercent(insight.topExpenseShare)} de tudo que saiu.`,
      );
    }
  }

  if ((topics.has('prazo') || topics.has('concentração')) && insight.periodTotals.length >= 2) {
    const first = insight.periodTotals[0];
    const last = insight.periodTotals[insight.periodTotals.length - 1];
    parts.push(
      `A evolução vai de ${money(first.total)} em ${first.period} a ${money(last.total)} em ${last.period}.`,
    );
  } else if (insight.periodTotals.length < 2) {
    parts.push('Evolução no tempo eu não consigo responder: o arquivo não tem coluna de data reconhecível.');
  }

  return parts.join(' ');
}

function addTableFindings(insight: TableInsight, out: Draft): void {
  out.findings.push({
    title: `Total de “${insight.column.name}”: ${money(insight.total)}`,
    detail:
      `Somei ${insight.entries.length} lançamento(s) da coluna “${insight.column.name}”` +
      (insight.labelColumnName ? `, identificados pela coluna “${insight.labelColumnName}”` : '') +
      `. Entradas somam ${money(insight.positiveTotal)} e saídas ${money(insight.negativeTotal)}, ` +
      `resultando em ${money(insight.total)}.`,
    severity: 'BAIXA',
  });

  // --- Revenue concentration, computed per label and not per row -----------
  const topClient = insight.revenueGroups[0];
  if (topClient && insight.topRevenueShare >= CONCENTRATION_MEDIUM) {
    const severity: FindingSeverity = insight.topRevenueShare >= CONCENTRATION_HIGH ? 'ALTA' : 'MEDIA';
    const others = insight.revenueGroups.length - 1;
    out.findings.push({
      title: `Concentração: “${topClient.label}” é ${formatPercent(insight.topRevenueShare)} da receita`,
      detail:
        `Somando os ${topClient.count} lançamento(s) de “${topClient.label}”, ele responde por ${money(topClient.value)} ` +
        `dos ${money(insight.positiveTotal)} que entraram — ${formatPercent(insight.topRevenueShare)}. ` +
        `Os outros ${others} pagador(es) juntos valem ${money(insight.positiveTotal - topClient.value)}. ` +
        'Perder esse único contrato não reduz o faturamento, muda a empresa de tamanho: nenhum dos outros compensa, ' +
        'nem somados.',
      severity,
    });
    out.risks.push(
      `Dependência de “${topClient.label}”: ${formatPercent(insight.topRevenueShare)} de toda a receita do período em um só pagador.`,
    );
    out.actions.push(
      `Definir a meta de reduzir “${topClient.label}” para menos de ${CONCENTRATION_HIGH}% da receita, e prospectar ativamente até chegar lá — a conta é quanto de receita nova, não quantos clientes.`,
    );
    out.skills.push('CONTROLLER', 'B2B_NETWORKING', 'LOCAL_SEO');
  }

  // --- Cost side -----------------------------------------------------------
  const topExpense = insight.expenseGroups[0];
  if (topExpense) {
    out.findings.push({
      title: `Maior saída: “${topExpense.label}” (${money(topExpense.value)})`,
      detail:
        `Em ${topExpense.count} lançamento(s), “${topExpense.label}” consome ${formatPercent(insight.topExpenseShare)} ` +
        `de tudo que saiu (${money(insight.negativeTotal)}). ` +
        (insight.positiveTotal > 0
          ? `Isso equivale a ${formatPercent((Math.abs(topExpense.value) / insight.positiveTotal) * 100)} de toda a receita do arquivo.`
          : ''),
      severity: Math.abs(topExpense.value) > insight.positiveTotal * 0.4 ? 'MEDIA' : 'BAIXA',
    });
  }

  if (insight.negativeTotal < 0 && Math.abs(insight.negativeTotal) > insight.positiveTotal) {
    out.findings.push({
      title: 'Saídas maiores que entradas no período do arquivo',
      detail:
        `As linhas negativas somam ${money(insight.negativeTotal)} contra ${money(insight.positiveTotal)} de positivas: ` +
        `o arquivo fecha em ${money(insight.total)}. Isso não é opinião sobre o negócio, é a soma das linhas que você enviou.`,
      severity: 'ALTA',
    });
    out.risks.push('O período coberto por este arquivo fecha negativo pela própria soma dos lançamentos.');
    out.actions.push('Abrir as três maiores saídas e classificar cada uma como custo fixo, variável ou pontual antes de cortar qualquer coisa.');
    out.skills.push('CONTROLLER', 'FINANCIAL_AUDIT');
  }

  // --- Movement over time --------------------------------------------------
  if (insight.periodTotals.length >= 2) {
    const movements = insight.periodTotals
      .slice(1)
      .map((entry, position) => ({
        from: insight.periodTotals[position],
        to: entry,
        delta: entry.total - insight.periodTotals[position].total,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const biggestMove = movements[0];
    const base = Math.abs(biggestMove.from.total);
    const percent = base > 0 ? (biggestMove.delta / base) * 100 : 0;

    out.findings.push({
      title: `Maior variação: ${biggestMove.from.period} → ${biggestMove.to.period}`,
      detail:
        `De ${money(biggestMove.from.total)} para ${money(biggestMove.to.total)} — ` +
        `${biggestMove.delta >= 0 ? 'alta' : 'queda'} de ${money(Math.abs(biggestMove.delta))}` +
        (base > 0 ? ` (${formatPercent(Math.abs(percent))})` : '') +
        `. A série coberta pelo arquivo vai de ${insight.periodTotals[0].period} a ` +
        `${insight.periodTotals[insight.periodTotals.length - 1].period}, em ${insight.periodTotals.length} períodos.`,
      severity: Math.abs(percent) >= 40 ? 'MEDIA' : 'BAIXA',
    });

    const incomplete = insight.periodTotals[insight.periodTotals.length - 1];
    if (movements.length >= 2 && Math.abs(incomplete.total) < Math.abs(insight.total / insight.periodTotals.length) / 2) {
      out.findings.push({
        title: `O último período (${incomplete.period}) parece incompleto`,
        detail:
          `${incomplete.period} fecha em ${money(incomplete.total)}, muito abaixo da média dos períodos anteriores. ` +
          'Antes de ler isso como queda, confira se o export foi tirado no meio do mês — metade de um mês comparado a ' +
          'meses inteiros produz um gráfico de crise que não existe.',
        severity: 'BAIXA',
      });
    }
  } else {
    out.findings.push({
      title: 'Sem coluna de data: não dá para ver evolução',
      detail:
        'Não há coluna de data ou competência reconhecível neste arquivo, então ele responde "quanto" mas não responde ' +
        '"desde quando" nem "está melhorando". Uma coluna de data transforma esta mesma planilha em série temporal sem nenhum trabalho adicional.',
      severity: 'MEDIA',
    });
    out.actions.push('Acrescentar uma coluna de data (ou competência) ao export, para que o mesmo arquivo passe a mostrar tendência.');
    out.skills.push('CONTROLLER');
  }

  // Only fires when the file HAS a period column and the same label+value
  // repeats inside the same period — a monthly retainer never trips it.
  if (insight.duplicates.length > 0) {
    const worst = insight.duplicates[0];
    out.findings.push({
      title: `Lançamentos repetidos dentro do mesmo período: ${insight.duplicates.length} caso(s)`,
      detail:
        `“${worst.label}” com o valor ${money(worst.value)} aparece ${worst.times} vezes em ${worst.period}. ` +
        'Mesmo rótulo, mesmo valor e mesma competência costuma ser duplicidade de lançamento — e ela infla o total que você acabou de ler.',
      severity: 'MEDIA',
    });
    out.risks.push('Possível duplicidade de lançamentos inflando o total do arquivo.');
    out.actions.push('Conferir os lançamentos repetidos contra o extrato antes de usar este total em qualquer decisão.');
    out.skills.push('FINANCIAL_AUDIT', 'AI_AUTOMATION');
  }
}

function tableSummary(input: AnalyzerInput, insight: TableInsight): string[] {
  const paragraphs: string[] = [];

  paragraphs.push(
    `“${input.filename}” abriu como tabela de ${insight.table.header.length} colunas e ${insight.table.rows.length} linhas ` +
      `(separador: ${delimiterLabel(insight.table.delimiter)}). A coluna que carrega o dinheiro é “${insight.column.name}”: ` +
      `${insight.entries.length} valores somando ${money(insight.total)}, sendo ${money(insight.positiveTotal)} de entrada ` +
      `e ${money(insight.negativeTotal)} de saída.`,
  );

  const top = insight.revenueGroups[0];
  if (top && insight.positiveTotal > 0) {
    const others = insight.revenueGroups.slice(1, 4);
    paragraphs.push(
      `A leitura que importa não é o total, é a distribuição — e ela só aparece quando os lançamentos são somados por ` +
        `${insight.labelColumnName ? `“${insight.labelColumnName}”` : 'rótulo'}, não lidos linha a linha. ` +
        `“${top.label}” concentra ${formatPercent(insight.topRevenueShare)} da entrada` +
        (others.length
          ? `, contra ${joinPtBr(others.map((group) => `“${group.label}” com ${formatPercent((group.value / insight.positiveTotal) * 100)}`))}.`
          : '.') +
        ` A mediana dos lançamentos individuais fica em ${money(medianOf(insight.entries.map((e) => e.value)))}: ` +
        'a maior parte das linhas é pequena e um punhado delas decide o resultado.',
    );
  }

  return paragraphs;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}


/**
 * Fallback for a financial document that is prose, not a table — a P&L pasted
 * into a text file, a bank statement copied out of a PDF. It works on the "R$"
 * amounts and the line each one sits on.
 */
function analyzeLooseAmounts(index: IndexedText, out: Draft): string[] {
  const amounts = moneyAmounts(index.original);
  if (amounts.length < 3) {
    out.findings.push({
      title: 'Arquivo sem números somáveis',
      detail:
        'Este arquivo não abriu como tabela e tem menos de três valores em reais reconhecíveis, então não somei nada: ' +
        'um total inventado a partir de texto solto seria pior do que nenhum total. Exporte em CSV (uma linha por ' +
        'lançamento, uma coluna de valor) e a análise passa a responder totais, concentração e variação.',
      severity: 'MEDIA',
    });
    out.actions.push('Reexportar o relatório em CSV com uma coluna de valor e uma de data para permitir a leitura numérica.');
    out.skills.push('CONTROLLER');
    return [
      'Não consegui abrir este arquivo como tabela e ele não traz valores suficientes para somar. Fui honesto e não somei — ' +
        'o que está abaixo vem só do texto.',
    ];
  }

  const total = amounts.reduce((sum, value) => sum + value, 0);
  const biggest = Math.max(...amounts.map((value) => Math.abs(value)));
  const share = total !== 0 ? (biggest / Math.abs(total)) * 100 : 0;
  const biggestLine = index.sentences.find((sentence) => moneyAmounts(sentence).some((v) => Math.abs(v) === biggest));

  out.findings.push({
    title: `${amounts.length} valores em reais somando R$ ${formatMoney(total)}`,
    detail:
      `Os valores foram lidos direto do texto (o arquivo não é tabular). O maior deles é R$ ${formatMoney(biggest)}` +
      (biggestLine ? `, na linha “${trimQuote(biggestLine, 160)}”` : '') +
      `, o que representa ${formatPercent(share)} da soma de tudo.`,
    severity: share >= CONCENTRATION_HIGH ? 'MEDIA' : 'BAIXA',
  });
  out.actions.push('Exportar o mesmo relatório em CSV para que totais, concentração e variação por período passem a ser calculados linha a linha.');
  out.skills.push('CONTROLLER', 'FINANCIAL_AUDIT');

  return [
    `Li ${amounts.length} valores em reais no corpo do arquivo, somando R$ ${formatMoney(total)}. ` +
      'Como o arquivo não é tabular, essa soma é do texto, não de colunas — trate-a como ordem de grandeza, não como fechamento contábil.',
  ];
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

interface ProposalItemSpec {
  key: string;
  label: string;
  terms: string[];
  severity: FindingSeverity;
  missingTitle: string;
  missingDetail: string;
  risk: string;
  action: string;
  skills: string[];
}

const PROPOSAL_ITEMS: ProposalItemSpec[] = [
  {
    key: 'preco',
    label: 'preço',
    terms: ['r$', 'investimento', 'valor', 'preco', 'honorari'],
    severity: 'ALTA',
    missingTitle: 'Proposta sem preço',
    missingDetail:
      'A proposta descreve trabalho mas não escreve nenhum valor. Uma proposta sem preço não é uma proposta, é uma ' +
      'apresentação — e obriga uma segunda conversa só para dizer o número, que é justamente onde a maioria dos negócios esfria.',
    risk: 'O cliente não consegue decidir com o que recebeu; a decisão é adiada por falta do dado principal.',
    action: 'Colocar o valor total e a forma de pagamento na primeira página, antes do detalhamento técnico.',
    skills: ['B2B_NETWORKING', 'CONTROLLER'],
  },
  {
    key: 'prazo',
    label: 'prazo',
    terms: ['prazo', 'dias', 'semanas', 'meses', 'cronograma', 'entrega'],
    severity: 'ALTA',
    missingTitle: 'Proposta sem prazo',
    missingDetail:
      'Não há prazo de execução nem cronograma. Sem data, o cliente não consegue comparar sua proposta com nenhuma outra, ' +
      'e você não consegue defender depois que a entrega "atrasou".',
    risk: 'Expectativa de prazo formada na cabeça do cliente, não no documento.',
    action: 'Incluir cronograma com as etapas principais e a data (ou o número de dias) de cada uma.',
    skills: ['STARTUPS', 'CONTROLLER'],
  },
  {
    key: 'exclusoes',
    label: 'o que não está incluído',
    terms: ['nao incluso', 'nao esta incluido', 'nao inclui', 'fora do escopo', 'nao contempla', 'excluidos'],
    severity: 'ALTA',
    missingTitle: 'Proposta sem lista de exclusões',
    missingDetail:
      'A proposta diz o que será feito e nunca diz o que não será. Toda expectativa não escrita é lida como incluída, ' +
      'e o custo dessa leitura aparece depois da assinatura, quando renegociar já custa relacionamento.',
    risk: 'Escopo entendido pelo cliente como maior do que o precificado.',
    action: 'Acrescentar um bloco "não está incluído" com três a cinco itens concretos.',
    skills: ['CONTROLLER', 'STARTUPS'],
  },
  {
    key: 'pagamento',
    label: 'forma de pagamento',
    terms: ['forma de pagamento', 'parcel', 'entrada', 'sinal', 'a vista', 'boleto', 'pix', 'cartao'],
    severity: 'MEDIA',
    missingTitle: 'Sem forma de pagamento',
    missingDetail:
      'O valor aparece mas não como ele é pago: entrada, parcelas, contra entrega. Isso deixa o fluxo de caixa do ' +
      'projeto indefinido justamente para quem precisa comprar insumo antes de receber.',
    risk: 'Início do trabalho sem entrada definida, financiando o cliente com capital próprio.',
    action: 'Definir entrada e cronograma de desembolso amarrados a marcos de entrega.',
    skills: ['PAYMENTS', 'CONTROLLER'],
  },
  {
    key: 'validade',
    label: 'validade da proposta',
    terms: ['validade', 'valida por', 'valida ate', 'proposta valida'],
    severity: 'MEDIA',
    missingTitle: 'Proposta sem prazo de validade',
    missingDetail:
      'Sem validade, a proposta continua valendo indefinidamente — inclusive daqui a seis meses, com outro custo de ' +
      'insumo e outra agenda. Validade curta também é o único mecanismo educado de criar urgência.',
    risk: 'Aceite tardio a um preço formado com custos que já mudaram.',
    action: 'Escrever "proposta válida por 15 dias" (ou o prazo que fizer sentido) junto ao valor.',
    skills: ['B2B_NETWORKING', 'CONTROLLER'],
  },
  {
    key: 'aceite',
    label: 'próximo passo',
    terms: ['aceite', 'aprovacao', 'assinatura', 'para iniciar', 'proximo passo', 'de acordo'],
    severity: 'MEDIA',
    missingTitle: 'Sem próximo passo definido',
    missingDetail:
      'A proposta termina sem dizer o que o cliente faz para contratar. Uma proposta que não pede uma ação específica ' +
      'delega ao cliente a tarefa de inventar o processo de compra — e a maioria não inventa, só arquiva.',
    risk: 'Proposta enviada e nunca respondida por falta de uma ação clara.',
    action: 'Encerrar com o passo exato para fechar: responder este e-mail, assinar o link, pagar a entrada.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
];

function analyzeProposal(input: AnalyzerInput, index: IndexedText, answer: QuestionAnswer): AnalyzedDocument {
  const out = draft();
  const values = moneyLiterals(input.text);
  const days = [...new Set(dayCounts(input.text))].sort((a, b) => a - b);

  const present: ProposalItemSpec[] = [];

  for (const item of PROPOSAL_ITEMS) {
    const quote = quoteFor(index, item.terms);
    if (quote) {
      present.push(item);
      continue;
    }
    out.findings.push({ title: item.missingTitle, detail: item.missingDetail, severity: item.severity });
    out.risks.push(item.risk);
    out.actions.push(item.action);
    out.skills.push(...item.skills);
  }

  if (values.length) {
    const priceLine = index.sentences.find((sentence) => /R\$/i.test(sentence));
    out.findings.push({
      title: `Preço na proposta: ${joinPtBr(values.slice(0, 3))}`,
      detail: priceLine
        ? `O valor aparece em “${trimQuote(priceLine, 200)}”.`
        : `Os valores encontrados no documento são ${joinPtBr(values.slice(0, 4))}.`,
      severity: 'BAIXA',
    });
  }

  if (days.length) {
    // Quote the line that carries the number, not the section heading that
    // merely says "PRAZO" — a heading is not evidence of anything.
    const deadlineLine =
      index.sentences.find((sentence) => /\d\s*\(?[^()]{0,20}\)?\s*dias?\b/i.test(sentence)) ??
      quoteFor(index, ['prazo', 'cronograma', 'entrega']);
    out.findings.push({
      title: `Prazo proposto: ${joinPtBr(days.slice(0, 3).map((d) => `${d} dias`))}`,
      detail:
        (deadlineLine ? `“${trimQuote(deadlineLine, 200)}”.` : '') +
        (containsAny(index, ['a contar', 'a partir da', 'apos a aprovacao', 'apos o pagamento'])
          ? ''
          : ' O documento não amarra esse prazo a um evento de início (aprovação, pagamento da entrada), o que o torna indefensável quando o cliente demorar a aprovar.'),
      severity: containsAny(index, ['a contar', 'a partir da', 'apos a aprovacao', 'apos o pagamento']) ? 'BAIXA' : 'MEDIA',
    });
  }

  const vagueQuotes = quotesFor(index, VAGUE_SCOPE_TERMS, 3);
  if (vagueQuotes.length) {
    out.findings.push({
      title: 'Escopo da proposta em termos abertos',
      detail:
        `${joinPtBr(vagueQuotes.map((q) => `“${q}”`))} — cada uma dessas expressões é um pedido futuro já autorizado. ` +
        'Numa proposta elas parecem generosidade comercial; na execução elas são trabalho não precificado.',
      severity: 'ALTA',
    });
    out.risks.push('Expressões abertas na proposta autorizam trabalho que não foi orçado.');
    out.actions.push('Trocar cada expressão aberta por uma quantidade ("até 3 rodadas", "2 visitas", "até 40 horas").');
    out.skills.push('CONTROLLER', 'STARTUPS');
  }

  const gaps = PROPOSAL_ITEMS.filter((item) => !present.includes(item)).map((item) => item.label);
  const paragraphs: string[] = [
    questionParagraph(index, input.question, answer, input.text.length, gaps),
  ];
  paragraphs.push(
    `“${input.filename}” é uma proposta comercial de ${index.lines.length} linhas. ` +
      (present.length ? `Ela cobre ${joinPtBr(present.map((item) => item.label))}.` : 'Nenhum dos blocos comerciais esperados foi encontrado.') +
      (values.length ? ` O valor apresentado é ${values[0]}.` : ''),
  );

  if (gaps.length && !(answer.gapFocused && answer.topics.length === 0)) {
    paragraphs.push(
      `O que falta é o que decide: ${joinPtBr(gaps)}. ` +
        'Uma proposta é lida uma vez, geralmente por quem vai comparar com outras duas — tudo que ela não responde vira ' +
        'motivo para adiar, não para perguntar.',
    );
  }

  if (out.actions.length) paragraphs.push(`Antes de enviar de novo: ${out.actions[0]}`);

  return finalize(buildHeadline('Proposta comercial', out.findings), paragraphs.join('\n\n'), out);
}

// ---------------------------------------------------------------------------
// Reports and everything else
// ---------------------------------------------------------------------------

function analyzeGeneric(input: AnalyzerInput, index: IndexedText, answer: QuestionAnswer): AnalyzedDocument {
  const out = draft();
  const values = moneyLiterals(input.text);
  const percents = percentLiterals(input.text);
  const dates = calendarDates(input.text);

  if (values.length >= 2) {
    const amounts = moneyAmounts(input.text);
    out.findings.push({
      title: `${values.length} valores monetários no documento`,
      detail:
        `Os que aparecem primeiro são ${joinPtBr(values.slice(0, 4))}. Somados, os valores lidos totalizam ` +
        `R$ ${formatMoney(amounts.reduce((sum, value) => sum + value, 0))} — soma de texto corrido, não de colunas, ` +
        'então serve como ordem de grandeza e não como fechamento.',
      severity: 'BAIXA',
    });
  }

  if (percents.length >= 2) {
    out.findings.push({
      title: `Percentuais citados: ${joinPtBr(percents.slice(0, 4))}`,
      detail:
        (quoteFor(index, [normalize(percents[0])]) ?? `O documento cita ${joinPtBr(percents.slice(0, 4))}`) +
        '. Confira contra o que cada percentual incide — a base de cálculo costuma ficar implícita.',
      severity: 'BAIXA',
    });
  }

  const vagueQuotes = quotesFor(index, VAGUE_SCOPE_TERMS, 3);
  if (vagueQuotes.length) {
    out.findings.push({
      title: 'Compromissos redigidos de forma aberta',
      detail: `${joinPtBr(vagueQuotes.map((q) => `“${q}”`))}. Nenhuma dessas expressões é verificável, o que significa que ninguém pode ser cobrado por elas.`,
      severity: 'MEDIA',
    });
    out.risks.push('Compromissos não verificáveis no documento não podem ser cobrados de ninguém.');
    out.actions.push('Reescrever cada compromisso aberto com número, prazo e responsável.');
    out.skills.push('CONTROLLER', 'STARTUPS');
  }

  const deadlineQuote = quoteFor(index, ['prazo', 'ate o dia', 'data limite', 'vencimento']);
  if (deadlineQuote) {
    out.findings.push({
      title: 'Prazo mencionado',
      detail: `“${deadlineQuote}”${dates.length ? ` Datas citadas no documento: ${joinPtBr(dates.slice(0, 3))}.` : ''}`,
      severity: 'BAIXA',
    });
  }

  const paragraphs: string[] = [questionParagraph(index, input.question, answer, input.text.length)];
  paragraphs.push(
    `“${input.filename}” tem ${index.lines.length} linhas e ${new Intl.NumberFormat('pt-BR').format(input.text.length)} caracteres. ` +
      'Ele não se identificou como contrato, proposta ou planilha, então não apliquei nenhuma checagem específica de tipo — ' +
      'o que está acima é o que o texto sustenta, e nada além disso.',
  );

  if (out.findings.length === 0) {
    paragraphs.push(
      'Não encontrei números, prazos nem compromissos verificáveis para analisar. Se você quer uma leitura mais afiada, ' +
        'reenvie o arquivo original (contrato, proposta ou export financeiro) em vez de um resumo — a análise trabalha ' +
        'sobre o texto, e resumo já perdeu justamente as cláusulas e os valores que valem a leitura.',
    );
  } else if (out.actions.length) {
    paragraphs.push(`Ação mais imediata: ${out.actions[0]}`);
  }

  return finalize(buildHeadline('Documento', out.findings), paragraphs.join('\n\n'), out);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function documentLabel(kind: WorkspaceDocKind, ctx: ContractContext): string {
  if (kind !== WorkspaceDocKind.CONTRATO) return 'Documento';
  if (ctx.isRecurring) return 'Contrato continuado';
  return 'Contrato';
}

/**
 * The headline names the two or three things that actually fired, in the
 * user's own domain terms. It is never a category ("Análise de contrato") —
 * a headline that would fit any document tells the reader nothing.
 */
function buildHeadline(label: string, findings: AnalysisFinding[]): string {
  const ordered = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const high = ordered.filter((finding) => finding.severity === 'ALTA');
  const medium = ordered.filter((finding) => finding.severity === 'MEDIA');
  const lead = (high.length ? high : medium).slice(0, 3).map((finding) => lowerFirst(finding.title));

  if (lead.length === 0) {
    return findings.length
      ? `${label}: ${lowerFirst(ordered[0].title)}`
      : `${label} sem pontos de atenção identificados`;
  }

  const tail = high.length > 3 ? ` (+${high.length - 3} de risco alto)` : '';
  return trimQuote(`${label}: ${joinPtBr(lead)}${tail}`, 160);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const ALLOWED_SKILLS = new Set<string>(MARKET_SKILL_TAGS);

/**
 * Orders, caps and de-duplicates. `suggestedSkills` is filtered against the
 * platform's real skill vocabulary — a skill no provider profile carries makes
 * the analysis unmatched, which kills the only thing this workspace has that a
 * generic chatbot does not.
 */
function finalize(headline: string, summary: string, out: Draft): AnalyzedDocument {
  const findings = dedupeBy(out.findings, (finding) => finding.title)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_FINDINGS);

  const skills = [...new Set(out.skills)].filter((skill) => ALLOWED_SKILLS.has(skill)).slice(0, MAX_SKILLS);

  return {
    headline,
    summary,
    findings,
    risks: [...new Set(out.risks)].slice(0, MAX_RISKS),
    actions: [...new Set(out.actions)].slice(0, MAX_ACTIONS),
    suggestedSkills: skills,
  };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Entry point. Routes on the classified kind — the routing is what makes the
 * output specific, because a contract question and a spreadsheet question have
 * nothing in common except the word "análise".
 */
export function analyzeDocument(input: AnalyzerInput): AnalyzedDocument {
  const index = indexText(input.text);
  const answer = answerQuestion(index, input.question);

  switch (input.kind) {
    case WorkspaceDocKind.CONTRATO:
      return analyzeContract(input, index, answer);
    case WorkspaceDocKind.FINANCEIRO:
    case WorkspaceDocKind.PLANILHA:
      return analyzeFinancial(input, index, answer);
    case WorkspaceDocKind.PROPOSTA:
      return analyzeProposal(input, index, answer);
    default:
      return analyzeGeneric(input, index, answer);
  }
}
