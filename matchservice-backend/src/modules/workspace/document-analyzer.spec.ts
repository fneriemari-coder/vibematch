import { WorkspaceDocKind } from '@prisma/client';
import { analyzeDocument } from './document-analyzer';
import { classifyDocument } from './document-classifier';
import { MARKET_SKILL_TAGS } from '../diagnostics/growth-analyzer';
import { parseNumber } from './text-utils';
import { analyzeTable, parseTable } from './table-parser';

const CONTRACT = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento particular, de um lado NORDESTE ALIMENTOS LTDA, doravante CONTRATANTE, e de outro ORBITA STUDIO ME, doravante CONTRATADA, têm entre si justo e acordado o seguinte.

CLÁUSULA PRIMEIRA - DO OBJETO
A CONTRATADA prestará serviços de criação e desenvolvimento do novo site institucional, incluindo identidade visual, implantação do sistema de pedidos online e demais serviços correlatos que se façam necessários.

CLÁUSULA SEGUNDA - DO PREÇO
A CONTRATANTE pagará à CONTRATADA o valor total de R$ 38.000,00, sendo R$ 11.400,00 de entrada e o saldo em duas parcelas de R$ 13.300,00, com vencimento em 10/07/2026 e 10/08/2026.

CLÁUSULA TERCEIRA - DO PRAZO
O prazo de execução dos serviços é de 90 dias.

CLÁUSULA QUARTA - DAS ALTERAÇÕES
A CONTRATANTE poderá solicitar alterações no projeto a qualquer tempo, devendo a CONTRATADA acomodá-las no cronograma vigente.`;

const CSV = `Data;Cliente;Categoria;Valor
05/01/2026;Rede Sabor Nordeste;Recorrente;28400,00
12/01/2026;Padaria Bom Dia;Pontual;3200,00
28/01/2026;Fornecedor de software;Despesa;-1890,00
03/02/2026;Rede Sabor Nordeste;Recorrente;28400,00
17/02/2026;Folha de pagamento;Despesa;-16200,00
02/03/2026;Rede Sabor Nordeste;Recorrente;28400,00
16/03/2026;Mercado Central Ltda;Pontual;5300,00`;

const PROPOSAL = `PROPOSTA COMERCIAL - GESTÃO DE MARKETING DIGITAL

Apresentamos a seguir nossa proposta comercial para a Ótica Visão Clara.

ESCOPO DO PROJETO
- Gestão das redes sociais
- Criação de peças gráficas
- Ajustes e melhorias contínuas conforme a necessidade do cliente

INVESTIMENTO
O investimento mensal é de R$ 4.800,00.

PRAZO
Início das atividades em até 10 dias após a aprovação desta proposta.`;

function analyzeContractWith(question: string) {
  return analyzeDocument({
    filename: 'contrato-servicos.txt',
    kind: WorkspaceDocKind.CONTRATO,
    text: CONTRACT,
    question,
  });
}

describe('document-classifier', () => {
  it('classifies a Portuguese service contract from its own vocabulary', () => {
    expect(classifyDocument('arquivo-01.txt', 'text/plain', CONTRACT)).toBe(WorkspaceDocKind.CONTRATO);
  });

  it('classifies a CSV export as a spreadsheet even when the filename says nothing', () => {
    expect(classifyDocument('export.txt', 'text/plain', CSV)).toBe(WorkspaceDocKind.PLANILHA);
  });

  it('classifies a commercial proposal', () => {
    expect(classifyDocument('proposta.txt', 'text/plain', PROPOSAL)).toBe(WorkspaceDocKind.PROPOSTA);
  });

  it('refuses to guess a type it has no evidence for', () => {
    const text = 'Reunião de segunda. Falamos sobre a equipe e ficou combinado que cada um traz uma ideia nova.';
    expect(classifyDocument('anotacoes.txt', 'text/plain', text)).toBe(WorkspaceDocKind.OUTRO);
  });

  it('does not let a mislabelled filename route a spreadsheet to the clause analyser', () => {
    expect(classifyDocument('contrato.csv', 'text/csv', CSV)).not.toBe(WorkspaceDocKind.CONTRATO);
  });
});

describe('document-analyzer — contracts', () => {
  it('reports the missing penalty clause as a high-severity finding', () => {
    const result = analyzeContractWith('Esse contrato me protege contra atraso de pagamento?');
    const penalty = result.findings.find((finding) => finding.title === 'Sem cláusula de multa');
    expect(penalty).toBeDefined();
    expect(penalty?.severity).toBe('ALTA');
  });

  it('leads the summary with the absence when the question is about something not in the document', () => {
    const result = analyzeContractWith('Tem multa se o cliente atrasar o pagamento?');
    expect(result.summary.startsWith('Você perguntou sobre')).toBe(true);
    expect(result.summary).toContain('ausência');
    expect(result.summary).toContain('multa');
  });

  it('never claims a clause is missing when it is present', () => {
    const result = analyzeContractWith('Como funciona o pagamento?');
    expect(result.findings.map((f) => f.title)).not.toContain('Sem condição de pagamento definida');
    expect(result.findings.map((f) => f.title)).not.toContain('Sem prazo de execução');
  });

  it('quotes the document verbatim instead of writing generic copy', () => {
    const result = analyzeContractWith('Quais são os riscos desse contrato?');
    const quoted = result.findings.some((finding) => finding.detail.includes('a qualquer tempo'));
    expect(quoted).toBe(true);
    expect(result.summary).toContain('R$ 38.000,00');
  });

  it('flags the open-ended scope wording it can point at', () => {
    const result = analyzeContractWith('O escopo está bem definido?');
    const vague = result.findings.find((finding) => finding.title === 'Escopo redigido em termos abertos');
    expect(vague).toBeDefined();
    expect(vague?.detail).toContain('demais serviços correlatos');
  });

  it('answers "o que está faltando" with the gap list rather than a keyword search', () => {
    const result = analyzeContractWith('O que está faltando nesse contrato antes de eu assinar?');
    expect(result.summary).toContain('Você perguntou o que está faltando');
    expect(result.summary).toContain('multa por descumprimento');
  });

  it('does not fire a topic on a substring inside an unrelated word', () => {
    // "mandar" contains "nda"; matching it as the NDA topic used to send a
    // question about a proposal to the confidentiality branch.
    const result = analyzeDocument({
      filename: 'proposta.txt',
      kind: WorkspaceDocKind.PROPOSTA,
      text: PROPOSAL,
      question: 'O que falta nessa proposta antes de eu mandar para o cliente?',
    });
    expect(result.summary).not.toContain('confidencialidade');
  });

  it('only suggests skills that exist in the platform vocabulary', () => {
    const result = analyzeContractWith('Quais são os riscos?');
    expect(result.suggestedSkills.length).toBeGreaterThan(0);
    for (const skill of result.suggestedSkills) {
      expect(MARKET_SKILL_TAGS as readonly string[]).toContain(skill);
    }
  });

  it('produces a headline naming the actual gaps, not a category', () => {
    const result = analyzeContractWith('Quais são os riscos?');
    expect(result.headline).toContain('multa');
    expect(result.headline).not.toBe('Análise de contrato');
  });
});

describe('document-analyzer — spreadsheets', () => {
  const analyze = (question: string) =>
    analyzeDocument({ filename: 'faturamento.csv', kind: WorkspaceDocKind.PLANILHA, text: CSV, question });

  it('measures concentration by client total, not by single row', () => {
    const result = analyze('Estou dependendo demais de um cliente só?');
    const concentration = result.findings.find((finding) => finding.title.startsWith('Concentração'));
    expect(concentration).toBeDefined();
    expect(concentration?.title).toContain('Rede Sabor Nordeste');
    // 3 × 28.400 = 85.200 of 93.700 in revenue = ~91%, only visible once grouped.
    expect(concentration?.detail).toContain('3 lançamento(s)');
    expect(concentration?.severity).toBe('ALTA');
  });

  it('sums the value column correctly with Brazilian number formatting', () => {
    const insight = analyzeTable(parseTable(CSV)!)!;
    expect(insight.column.name).toBe('Valor');
    expect(Math.round(insight.positiveTotal)).toBe(93700);
    expect(Math.round(insight.negativeTotal)).toBe(-18090);
  });

  it('does not flag a monthly recurring invoice as a duplicate', () => {
    const insight = analyzeTable(parseTable(CSV)!)!;
    expect(insight.duplicates).toHaveLength(0);
  });

  it('answers a spreadsheet question with arithmetic, not with a quoted header row', () => {
    const result = analyze('Estou dependendo demais de um cliente só?');
    expect(result.summary).not.toContain('Data;Cliente');
    expect(result.summary).toContain('de toda a entrada do arquivo');
  });
});

describe('document-analyzer — proposals', () => {
  const analyze = (question: string) =>
    analyzeDocument({ filename: 'proposta.txt', kind: WorkspaceDocKind.PROPOSTA, text: PROPOSAL, question });

  it('reports what the proposal leaves undefined', () => {
    const titles = analyze('O que falta nessa proposta?').findings.map((finding) => finding.title);
    expect(titles).toContain('Proposta sem lista de exclusões');
    expect(titles).toContain('Sem forma de pagamento');
  });

  it('does not report a missing price when the price is there', () => {
    const titles = analyze('Está tudo certo?').findings.map((finding) => finding.title);
    expect(titles).not.toContain('Proposta sem preço');
  });

  it('quotes the line that carries the deadline, not the section heading', () => {
    const deadline = analyze('Qual o prazo?').findings.find((finding) => finding.title.startsWith('Prazo proposto'));
    expect(deadline?.detail).toContain('10 dias após a aprovação');
  });
});

describe('document-analyzer — restraint', () => {
  it('produces few findings and no filler for a document with nothing in it', () => {
    const result = analyzeDocument({
      filename: 'nota.txt',
      kind: WorkspaceDocKind.OUTRO,
      text: 'Lembrete: ligar para o fornecedor amanhã de manhã e confirmar o horário da visita técnica.',
      question: 'O que esse documento diz sobre pagamento?',
    });
    expect(result.findings.length).toBeLessThanOrEqual(2);
    expect(result.summary).not.toContain('em breve');
    expect(result.summary.toLowerCase()).toContain('ausência');
  });

  it('caps findings so a rich document cannot flood the screen', () => {
    const result = analyzeContractWith('Quais são todos os riscos?');
    expect(result.findings.length).toBeLessThanOrEqual(8);
    expect(result.suggestedSkills.length).toBeLessThanOrEqual(5);
  });
});

describe('parseNumber', () => {
  it('reads Brazilian and US formats and refuses non-numbers', () => {
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumber('R$ 38.000,00')).toBeCloseTo(38000);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56);
    expect(parseNumber('(1.200,00)')).toBeCloseTo(-1200);
    expect(parseNumber('N/A')).toBeNull();
    expect(parseNumber('março')).toBeNull();
  });
});
