import { GrowthPillar } from '@prisma/client';

/**
 * Deterministic local growth analyser — the offline half of
 * `diagnostics.service.ts`, in the same spirit as `ai-course-composer.ts` is
 * the offline half of the AI course factory.
 *
 * This is NOT a placeholder. `OPENAI_API_KEY` is routinely absent, stale, or
 * simply unreachable from the network the demo runs on, and a radar chart that
 * says "indisponível" is worse than no radar at all — the diagnostic is the
 * entry point of the whole ecosystem thesis (education originates business),
 * so it is the one endpoint that must never fail to say something true.
 *
 * How it works: every signal below is a phrase a Brazilian manager actually
 * writes when describing a problem, bound to the pillar that problem lives in,
 * with the mechanism that phrase implies (`insight`), the first concrete move
 * it calls for (`recommendation`), and the market skill tags that would let
 * the platform match them to someone who does that work (`skills`).
 *
 * Scoring: every pillar starts at BASELINE and only loses points for evidence
 * present in the text. A pillar the manager never mentioned stays at BASELINE
 * and the summary says so — the analyser never invents a weakness it has no
 * evidence for.
 */

/** Where an unmentioned pillar sits. Not a score — an "unknown, assumed average". */
const BASELINE = 70;
/** Floor. Even the worst-described pillar keeps a usable radar value. */
const FLOOR = 15;
/**
 * Each additional signal on the same pillar counts 70% of the previous one's
 * weight. More evidence should move the score further, but the fifth mention
 * of a cash problem is not five times the information of the first.
 */
const EVIDENCE_DECAY = 0.7;

const MAX_RECOMMENDATIONS = 4;
const MAX_SUGGESTED_SKILLS = 5;

export const PILLAR_LABELS: Record<GrowthPillar, string> = {
  VENDAS: 'Vendas',
  GESTAO: 'Gestão',
  TECNOLOGIA: 'Tecnologia',
  FINANCAS: 'Finanças',
};

/**
 * The uppercase market skill vocabulary this platform already speaks —
 * the exact strings carried by `UserProfile.skills`, `PostTag.tagName` and
 * `BusinessCourse.skillsTaught` (see prisma/seed.ts, prisma/seed-ai-courses.ts
 * and src/modules/admin/simulation.core.ts).
 *
 * `suggestedSkills` is drawn only from this list, and the model is constrained
 * to it by the JSON schema in diagnostics.service.ts. That constraint is the
 * whole point: a diagnostic is a briefing, and a briefing that names a skill
 * no provider has is a dead end.
 */
export const MARKET_SKILL_TAGS = [
  'AI_AUTOMATION',
  'B2B_NETWORKING',
  'BACKEND',
  'CONTROLLER',
  'DESIGN',
  'FINANCIAL_AUDIT',
  'FLOOR_INSTALLATION',
  'LOCAL_SEO',
  'LOCAL_SERVICE',
  'MAINTENANCE',
  'MAKE',
  'PAYMENTS',
  'PLUMBING',
  'SHORT_FORM',
  'STARTUPS',
  'STRIPE_WEBHOOK',
  'SaaS',
  'UI_UX',
  'VIDEO_EDITING',
] as const;

/** Fallback tags per pillar, used to pad a thin briefing. */
const PILLAR_DEFAULT_SKILLS: Record<GrowthPillar, string[]> = {
  VENDAS: ['B2B_NETWORKING', 'LOCAL_SEO', 'SHORT_FORM'],
  GESTAO: ['CONTROLLER', 'STARTUPS', 'MAINTENANCE'],
  TECNOLOGIA: ['AI_AUTOMATION', 'MAKE', 'SaaS'],
  FINANCAS: ['CONTROLLER', 'FINANCIAL_AUDIT', 'PAYMENTS'],
};

interface PillarSignal {
  pillar: GrowthPillar;
  /** Normalized (lowercase, unaccented) fragments that fire this signal. */
  terms: string[];
  /** Points off BASELINE this costs its pillar, before the decay above. */
  severity: number;
  /** Named back to the manager in the summary, e.g. "custo unitário desconhecido". */
  label: string;
  /** The mechanism THIS phrase implies. This is what keeps the summary analysis, not filler. */
  insight: string;
  /** The first concrete move. Feeds `recommendations`. */
  recommendation: string;
  /** Tags from MARKET_SKILL_TAGS that can actually be matched to a provider. */
  skills: string[];
}

const SIGNALS: PillarSignal[] = [
  // --- FINANÇAS ------------------------------------------------------------
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['nao sei quanto custa', 'nao sei o custo', 'nao sei quanto sai', 'quanto custa cada', 'custo real'],
    severity: 15,
    label: 'custo unitário desconhecido',
    insight:
      'Sem saber o custo real de cada entrega, todo preço é chute: dá para estar vendendo muito bem exatamente aquilo que dá prejuízo, e recusando o que dava margem.',
    recommendation:
      'Levantar o custo real por serviço (mão de obra + insumo + rateio de estrutura) antes de mexer em qualquer preço.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['fluxo de caixa', 'sem dinheiro em caixa', 'falta dinheiro', 'aperto de caixa', 'sobra nada'],
    severity: 14,
    label: 'caixa sem projeção',
    insight:
      'Caixa que só aparece quando já apertou é problema de projeção, não de faturamento — o mesmo aperto é visível com seis semanas de antecedência numa projeção rolante.',
    recommendation: 'Montar a projeção de caixa rolante de 13 semanas e reatualizá-la toda segunda-feira.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['margem', 'lucro', 'prejuizo', 'no vermelho'],
    severity: 12,
    label: 'margem fora de controle',
    insight:
      'Faturamento subindo com margem caindo é o padrão exato da empresa que quebra lucrativa no papel: o resultado só aparece no fechamento, quando já não dá para corrigir o mês.',
    recommendation:
      'Apurar margem por serviço e por cliente — não só a margem total da empresa — e repreçar ou cortar a cauda que dá prejuízo.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['inadimplen', 'nao me pagam', 'nao pagam', 'calote', 'atraso no pagamento', 'pagam atrasado'],
    severity: 13,
    label: 'inadimplência',
    insight:
      'Inadimplência não se resolve cobrando mais forte no fim; ela se resolve na régua — quando cobra, por qual canal, e o que acontece no dia seguinte ao vencimento.',
    recommendation:
      'Definir uma régua de cobrança automática: lembrete antes do vencimento, cobrança no dia, escalonamento em D+3 e D+15.',
    skills: ['PAYMENTS', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['capital de giro', 'emprestimo', 'juros', 'antecipa'],
    severity: 13,
    label: 'dependência de capital caro',
    insight:
      'Recorrer a capital de giro todo mês é sintoma, não causa: quase sempre o ciclo de caixa está invertido — você paga antes de receber e financia o cliente sem cobrar por isso.',
    recommendation:
      'Medir o ciclo de caixa em dias e renegociar prazo com os três maiores fornecedores antes de tomar mais crédito.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['cobranca', 'boleto', 'recebiv', 'emitir nota', 'nota fiscal'],
    severity: 10,
    label: 'faturamento e cobrança manuais',
    insight:
      'Cobrança feita à mão vaza em silêncio: a entrega que ninguém lembrou de faturar não aparece em relatório nenhum, porque para o sistema ela nunca existiu.',
    recommendation:
      'Automatizar emissão e conciliação da cobrança, com uma tela única de "faturado x recebido" fechando todo dia.',
    skills: ['PAYMENTS', 'STRIPE_WEBHOOK'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['preco', 'precific', 'tabela de preco', 'mais barato', 'caro demais'],
    severity: 10,
    label: 'preço sem método',
    insight:
      'Preço definido por comparação com o concorrente transfere para a sua empresa o erro de conta que ele cometeu.',
    recommendation:
      'Reconstruir a tabela de preço a partir de custo + margem-alvo e testar o preço novo em um segmento antes de aplicar a todos.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['imposto', 'contador', 'regime tributario', 'tributo'],
    severity: 9,
    label: 'carga tributária não revisada',
    insight:
      'Enquadramento tributário é uma das poucas alavancas que muda o resultado sem depender de vender mais nem de cortar ninguém.',
    recommendation:
      'Revisar com o contador o enquadramento e o imposto efetivo por tipo de serviço — a diferença entre regimes costuma valer mais que uma campanha inteira.',
    skills: ['FINANCIAL_AUDIT', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.FINANCAS,
    terms: ['dinheiro', 'custo', 'despesa', 'gasto'],
    severity: 8,
    label: 'controle de custos frouxo',
    insight:
      'Custo que ninguém acompanha semanalmente cresce na velocidade do faturamento — e depois some no meio dele.',
    recommendation:
      'Separar custo fixo de custo variável e acompanhar os cinco maiores itens toda semana, não só no fechamento do mês.',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT'],
  },

  // --- VENDAS --------------------------------------------------------------
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['nao consigo fechar', 'nao fecho', 'nao fecha', 'perco o cliente', 'perdendo cliente', 'nao converte'],
    severity: 15,
    label: 'proposta que não fecha',
    insight:
      'Quando o contato chega e não fecha, o furo está entre a conversa e a proposta: falta ancorar o resultado antes de mostrar o preço, e falta um retorno com data marcada na frente do cliente.',
    recommendation:
      'Padronizar a proposta em uma página (problema, escopo, resultado esperado, preço) e marcar o follow-up com o cliente ainda na reunião.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['vendas cairam', 'caiu as vendas', 'queda nas vendas', 'vendendo menos', 'faturamento caiu', 'movimento caiu'],
    severity: 15,
    label: 'queda de vendas',
    insight:
      'Queda de vendas quase nunca é um evento: é uma etapa do funil que parou. Ou entra menos gente, ou a resposta ficou mais lenta, ou o preço saiu da faixa que o mercado aceita.',
    recommendation:
      'Comparar os últimos três meses etapa por etapa — contatos recebidos, propostas enviadas, propostas fechadas — para achar em qual delas a queda começou.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['lead', 'captacao', 'contato novo', 'ninguem procura'],
    severity: 11,
    label: 'geração de demanda',
    insight:
      'Volume de lead sem qualificação enche a agenda e não enche o caixa: metade do tempo comercial vai para quem nunca teria comprado.',
    recommendation:
      'Definir três perguntas de qualificação no primeiro contato e recusar rápido quem não passa — isso devolve tempo comercial para quem fecha.',
    skills: ['B2B_NETWORKING', 'LOCAL_SEO'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['indicacao', 'boca a boca'],
    severity: 12,
    label: 'pipeline dependente de indicação',
    insight:
      'Indicação é a melhor aquisição e o pior canal único: ela não escala no ritmo que você decide, escala no ritmo dos seus clientes.',
    recommendation:
      'Manter a indicação e abrir um segundo canal previsível (presença local ou conteúdo) com meta semanal de novos contatos.',
    skills: ['LOCAL_SEO', 'B2B_NETWORKING'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['proposta', 'orcamento', 'cotacao'],
    severity: 10,
    label: 'orçamento como gargalo',
    insight:
      'Orçamento que demora dias para sair perde para quem respondeu em horas, mesmo cobrando mais caro — velocidade de resposta é lida pelo cliente como confiabilidade.',
    recommendation:
      'Criar um modelo de orçamento com faixas de escopo já precificadas, para responder no mesmo dia sem recalcular do zero.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['desconto', 'baixar o preco', 'guerra de preco'],
    severity: 11,
    label: 'desconto como argumento',
    insight:
      'Desconto recorrente é o que se paga por não ter conseguido explicar o valor — e ele reeduca o cliente a esperar o desconto na próxima.',
    recommendation:
      'Trocar desconto por escopo: ofereça uma versão menor por um preço menor, nunca o mesmo escopo mais barato.',
    skills: ['B2B_NETWORKING'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['funil', 'pipeline', 'crm', 'follow up', 'follow-up'],
    severity: 10,
    label: 'funil sem visibilidade',
    insight:
      'Sem registro de etapa e de próximo passo, "como estão as vendas" é opinião, não número — e o contato que sumiu no meio nunca é percebido.',
    recommendation:
      'Registrar todo contato em um funil único com etapa e data do próximo passo, e revisar essa lista uma vez por semana.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['instagram', 'anuncio', 'trafego pago', 'redes sociais', 'divulga', 'marketing'],
    severity: 9,
    label: 'mídia sem retorno medido',
    insight:
      'Investimento em mídia sem custo por cliente fechado é despesa, não aquisição: sem esse número não dá para saber se aumentar a verba melhora ou piora o resultado.',
    recommendation:
      'Medir custo por contato e custo por cliente fechado em cada canal antes de aumentar qualquer verba de mídia.',
    skills: ['SHORT_FORM', 'VIDEO_EDITING'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['concorrente', 'concorrencia'],
    severity: 8,
    label: 'diferenciação pouco clara',
    insight:
      'Quando o cliente não enxerga diferença, ele decide pelo único critério que sempre entende: o preço.',
    recommendation:
      'Escrever em uma frase por que alguém contrata você e não o concorrente mais barato — e abrir toda proposta com ela.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['no bairro', 'na regiao', 'minha cidade', 'clientes da regiao', 'aqui na cidade'],
    severity: 9,
    label: 'presença local fraca',
    insight:
      'Para serviço local, quem aparece primeiro na busca do bairro recebe o orçamento — e quem não aparece disputa o que sobrou.',
    recommendation:
      'Reivindicar e completar o perfil no Google Empresas e pedir avaliação a cada cliente atendido: é o canal mais barato para serviço local.',
    skills: ['LOCAL_SEO', 'LOCAL_SERVICE'],
  },
  {
    pillar: GrowthPillar.VENDAS,
    terms: ['cliente', 'vender', 'venda', 'vendas'],
    severity: 6,
    label: 'processo comercial informal',
    insight:
      'Um comercial que existe só na cabeça de quem vende não pode ser ensinado a mais ninguém — o que trava o crescimento antes de qualquer verba de marketing.',
    recommendation:
      'Escrever o passo a passo da venda (primeiro contato, qualificação, proposta, retorno) para que outra pessoa consiga repetir.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
  },

  // --- GESTÃO --------------------------------------------------------------
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['retrabalho', 'refazer', 'refaz', 'refeito'],
    severity: 15,
    label: 'retrabalho',
    insight:
      'Retrabalho é o custo que não aparece em conta nenhuma: ele sai do lucro disfarçado de hora extra e de prazo estourado, e some do relatório porque ninguém o mede.',
    recommendation:
      'Medir quantas horas por semana vão para refazer trabalho já entregue e atacar a causa das duas maiores ocorrências.',
    skills: ['CONTROLLER', 'MAINTENANCE'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['eu faco tudo', 'depende de mim', 'so eu sei', 'centraliz', 'sou o gargalo', 'tudo passa por mim'],
    severity: 15,
    label: 'operação centralizada no dono',
    insight:
      'Quando tudo passa por uma pessoa, o teto da empresa é a agenda dela: crescer passa a significar, na prática, trabalhar mais horas do que existem no dia.',
    recommendation:
      'Escolher as duas decisões que mais te interrompem e delegá-las com critério escrito: o que pode, o que não pode, e quando escalar.',
    skills: ['STARTUPS', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['apagando incendio', 'apagar incendio', 'correria', 'sobrecarregad', 'sem tempo', 'nao dou conta'],
    severity: 13,
    label: 'operação em modo urgência',
    insight:
      'Urgência permanente é ausência de planejamento semanal: sem uma fila definida na segunda, a prioridade do dia passa a ser quem gritou mais alto.',
    recommendation:
      'Fechar a fila da semana na segunda de manhã e tratar o que chegar depois como exceção registrada, não como prioridade automática.',
    skills: ['CONTROLLER', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['atraso', 'atrasad', 'prazo', 'nao entrego'],
    severity: 12,
    label: 'prazos estourando',
    insight:
      'Prazo estourado com frequência costuma ser capacidade prometida a mais, não esforço a menos: vende-se mais entrega do que a semana comporta.',
    recommendation:
      'Limitar quantos trabalhos ficam em execução ao mesmo tempo e só puxar o próximo quando um sair — fila curta entrega mais rápido que fila longa.',
    skills: ['MAINTENANCE', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['rotatividade', 'turnover', 'ninguem fica', 'perco funcionario', 'pediu demissao'],
    severity: 12,
    label: 'rotatividade de equipe',
    insight:
      'Cada saída leva embora o processo que só existia na cabeça de quem saiu — e o custo real não é a rescisão, é os três meses até o substituto render igual.',
    recommendation:
      'Fazer entrevista de saída com as três últimas pessoas que saíram e agir sobre o motivo que se repetir.',
    skills: ['STARTUPS', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['processo', 'padroniz', 'procedimento', 'cada um faz'],
    severity: 11,
    label: 'processo não padronizado',
    insight:
      'Sem processo escrito, a qualidade da entrega é a média do humor da equipe naquele dia — e não se treina ninguém em algo que só existe na cabeça de uma pessoa.',
    recommendation:
      'Escrever o passo a passo do serviço mais vendido em uma página e usá-lo como checklist obrigatório de entrega.',
    skills: ['CONTROLLER', 'STARTUPS'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['reclamacao', 'cliente insatisfeito', 'qualidade', 'erro'],
    severity: 11,
    label: 'qualidade instável',
    insight:
      'Reclamação tratada uma a uma some do radar; reclamação registrada revela que três clientes diferentes reclamaram da mesma etapa.',
    recommendation:
      'Registrar toda reclamação em uma lista única com causa e responsável, e revisar as recorrentes toda semana.',
    skills: ['MAINTENANCE', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['equipe', 'funcionario', 'colaborador', 'meu time', 'a equipe'],
    severity: 8,
    label: 'papéis pouco definidos',
    insight:
      'Time sem dono claro por etapa gera espera: todo mundo supõe que a bola está com o outro, e o trabalho para no meio sem ninguém perceber.',
    recommendation:
      'Definir por escrito quem decide o quê — uma linha por pessoa — e revisar isso numa reunião semanal de 30 minutos.',
    skills: ['STARTUPS', 'CONTROLLER'],
  },
  {
    pillar: GrowthPillar.GESTAO,
    terms: ['treinamento', 'treinar', 'ensinar', 'contratar'],
    severity: 8,
    label: 'treinamento artesanal',
    insight:
      'Treinar cada pessoa nova do zero cobra o mesmo preço toda vez: o tempo de quem já sabe, que é exatamente o recurso mais escasso da empresa.',
    recommendation:
      'Gravar uma única vez o treinamento das cinco tarefas mais repetidas e reutilizar em cada contratação.',
    skills: ['STARTUPS', 'CONTROLLER'],
  },

  // --- TECNOLOGIA ----------------------------------------------------------
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['manual', 'na mao', 'digita', 'copia e cola', 'copiar e colar', 'um por um'],
    severity: 14,
    label: 'trabalho manual repetitivo',
    insight:
      'Toda tarefa repetida à mão é custo fixo disfarçado de rotina — e é a primeira coisa que quebra no dia em que o volume dobra.',
    recommendation:
      'Mapear as três tarefas mais repetidas da semana e automatizar primeiro a que tem a regra mais clara.',
    skills: ['AI_AUTOMATION', 'MAKE'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['integracao', 'integrar', 'nao conversa', 'dois sistemas', 'sistemas separados'],
    severity: 13,
    label: 'sistemas que não conversam',
    insight:
      'Dois sistemas que não conversam criam um terceiro sistema: a pessoa que passa o dado de um para o outro — cara, lenta e sujeita a erro de digitação.',
    recommendation:
      'Integrar o cadastro de cliente entre as duas ferramentas mais usadas: é a integração que elimina mais digitação duplicada por real investido.',
    skills: ['MAKE', 'AI_AUTOMATION', 'BACKEND'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['papel', 'caderno', 'anoto', 'anotado'],
    severity: 12,
    label: 'registro em papel',
    insight:
      'Dado em papel não é pesquisável, não é somável e não é recuperável: nenhuma automação posterior tem base enquanto o cadastro viver num caderno.',
    recommendation:
      'Digitalizar primeiro o cadastro de cliente e a agenda — sem esses dois, qualquer sistema comprado depois nasce vazio.',
    skills: ['SaaS', 'AI_AUTOMATION'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['sistema', 'erp', 'software', 'ferramenta'],
    severity: 11,
    label: 'sistema que não sustenta a operação',
    insight:
      'Sistema que a equipe contorna por fora deixa de ser fonte de verdade: a operação real migra para conversas e arquivos soltos, e o relatório passa a descrever uma empresa que não existe.',
    recommendation:
      'Listar onde a equipe contorna o sistema hoje e resolver esses contornos antes de considerar trocar de ferramenta.',
    skills: ['SaaS', 'BACKEND'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['perdi arquivo', 'perdemos dados', 'backup', 'seguranca'],
    severity: 11,
    label: 'dados sem proteção',
    insight:
      'Dado de cliente sem backup testado é um risco que só aparece uma vez — e nesse dia ele custa o histórico inteiro da empresa.',
    recommendation:
      'Ativar backup automático diário nos dois sistemas que guardam dado de cliente e testar a restauração pelo menos uma vez.',
    skills: ['BACKEND', 'SaaS'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['whatsapp', 'zap'],
    severity: 10,
    label: 'operação inteira no WhatsApp',
    insight:
      'Quando o histórico do cliente só existe no WhatsApp de alguém, a empresa não tem memória — ela tem o celular de um funcionário.',
    recommendation:
      'Centralizar o atendimento em um número da empresa, com histórico compartilhado e etiquetas por etapa do atendimento.',
    skills: ['AI_AUTOMATION', 'SaaS'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['site', 'landing', 'pagina', 'nao tenho site'],
    severity: 10,
    label: 'presença digital fraca',
    insight:
      'Site que não diz em cinco segundos o que você faz e para quem transforma qualquer tráfego, pago ou orgânico, em visita perdida.',
    recommendation:
      'Reescrever a página inicial em torno de um único serviço, com prova (caso, foto ou avaliação) e um botão de contato acima da dobra.',
    skills: ['UI_UX', 'DESIGN', 'LOCAL_SEO'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['planilha', 'excel'],
    severity: 9,
    label: 'planilha usada como sistema',
    insight:
      'A planilha que resolveu o problema do ano passado é o problema deste: ela não valida entrada, não registra quem mudou o quê, e quebra em silêncio.',
    recommendation:
      'Tirar da planilha primeiro o processo com mais gente editando ao mesmo tempo — é onde o erro custa mais caro.',
    skills: ['SaaS', 'BACKEND'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['relatorio', 'indicador', 'metrica', 'nao tenho dado'],
    severity: 9,
    label: 'indicadores montados à mão',
    insight:
      'Relatório que depende de alguém montando só é lido quando já é tarde — e o mês em que a pessoa está ocupada é justamente o mês em que ninguém olha.',
    recommendation:
      'Definir cinco indicadores e automatizar a coleta deles: relatório que ninguém precisa montar é relatório que se lê toda semana.',
    skills: ['BACKEND', 'SaaS'],
  },
  {
    pillar: GrowthPillar.TECNOLOGIA,
    terms: ['pix', 'cartao', 'checkout', 'pagamento online', 'maquininha'],
    severity: 9,
    label: 'pagamento sem conciliação',
    insight:
      'Conferir pagamento à mão custa pouco por transação e muito por mês — e é onde o dinheiro que entrou e ninguém baixou fica escondido.',
    recommendation:
      'Habilitar cobrança online com conciliação automática, para parar de conferir recebimento transação a transação.',
    skills: ['PAYMENTS', 'STRIPE_WEBHOOK'],
  },
];

export interface AnalyzedDiagnostic {
  scores: Record<GrowthPillar, number>;
  weakestPillar: GrowthPillar;
  summary: string;
  recommendations: string[];
  suggestedSkills: string[];
}

interface MatchedSignal {
  signal: PillarSignal;
  /** The exact term that fired, as written in the manager's own text. */
  term: string;
  /** The sentence the term appeared in, in the original spelling and accents. */
  quote: string;
}

/** Lowercase + strip diacritics, so "orçamento" and "ORCAMENTO" both match. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Splits on sentence terminators AND newlines — managers write these in
 * bullet-ish paragraphs at least as often as in prose, and a "sentence" that
 * swallowed three bullets would quote back something unreadable.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const MAX_QUOTE_LENGTH = 200;

function trimQuote(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').replace(/[.;\s]+$/, '');
  if (clean.length <= MAX_QUOTE_LENGTH) return clean;
  return `${clean.slice(0, MAX_QUOTE_LENGTH).trimEnd()}…`;
}

function findMatches(situation: string): MatchedSignal[] {
  const sentences = splitSentences(situation);
  const normalizedSentences = sentences.map(normalize);
  const normalizedAll = normalize(situation);

  const matches: MatchedSignal[] = [];
  for (const signal of SIGNALS) {
    // Longest term first: when both "nao fecha" and "nao consigo fechar" could
    // fire, quote back the more specific one the manager actually wrote.
    const term = [...signal.terms]
      .sort((a, b) => b.length - a.length)
      .find((t) => normalizedAll.includes(t));
    if (!term) continue;

    const sentenceIndex = normalizedSentences.findIndex((s) => s.includes(term));
    const quote = trimQuote(sentenceIndex >= 0 ? sentences[sentenceIndex] : situation);
    matches.push({ signal, term, quote });
  }
  return matches;
}

function scoreFor(signals: PillarSignal[]): number {
  const penalty = [...signals]
    .sort((a, b) => b.severity - a.severity)
    .reduce((total, signal, index) => total + signal.severity * EVIDENCE_DECAY ** index, 0);
  return Math.max(FLOOR, Math.round(BASELINE - penalty));
}

const PILLAR_ORDER: GrowthPillar[] = [
  GrowthPillar.VENDAS,
  GrowthPillar.GESTAO,
  GrowthPillar.TECNOLOGIA,
  GrowthPillar.FINANCAS,
];

/**
 * Lowest score wins; ties break towards the pillar with more distinct evidence,
 * then towards the higher raw severity, then by a fixed pillar order so the
 * same text always produces the same reading.
 */
export function pickWeakestPillar(
  scores: Record<GrowthPillar, number>,
  byPillar: Record<GrowthPillar, PillarSignal[]>,
): GrowthPillar {
  return [...PILLAR_ORDER].sort((a, b) => {
    if (scores[a] !== scores[b]) return scores[a] - scores[b];
    if (byPillar[a].length !== byPillar[b].length) return byPillar[b].length - byPillar[a].length;
    const severityA = byPillar[a].reduce((t, s) => t + s.severity, 0);
    const severityB = byPillar[b].reduce((t, s) => t + s.severity, 0);
    if (severityA !== severityB) return severityB - severityA;
    return PILLAR_ORDER.indexOf(a) - PILLAR_ORDER.indexOf(b);
  })[0];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The reading returned when nothing in the text maps to a pillar — a manager
 * who wrote 40 characters of context and no symptom. It scores nothing and
 * says so, then asks the four questions that would make a real reading
 * possible. Honest beats confident here: a fabricated weak pillar would send
 * the whole recommendation chain in a random direction.
 */
function genericReading(situation: string): AnalyzedDiagnostic {
  const scores: Record<GrowthPillar, number> = {
    VENDAS: BASELINE,
    GESTAO: BASELINE,
    TECNOLOGIA: BASELINE,
    FINANCAS: BASELINE,
  };
  const opening = trimQuote(splitSentences(situation)[0] ?? situation);

  return {
    scores,
    weakestPillar: GrowthPillar.GESTAO,
    summary:
      `Você escreveu “${opening}”, mas o relato ainda não traz um sintoma concreto o suficiente para pontuar um pilar acima ` +
      'dos outros — por isso os quatro estão na linha de base (70/100), que aqui significa "sem evidência", não "está bom". ' +
      'Um diagnóstico útil precisa de fato observável: um número que caiu, uma tarefa que se repete, um prazo que estoura, ' +
      'uma conta que você não consegue fechar. Reescreva descrevendo o que aconteceu na sua última semana ruim — ' +
      'o que você fez, o que travou e o que o cliente reclamou — e o diagnóstico passa a apontar para um pilar específico.',
    recommendations: [
      'Descrever o problema em fatos: o que aconteceu, quantas vezes na última semana e quanto custou (em horas ou em dinheiro).',
      'Responder às quatro perguntas do radar: quantos clientes novos entraram no mês, quanto sobrou depois de tudo pago, quantas horas foram para refazer trabalho, e quais tarefas foram feitas à mão.',
      'Levantar os três números que você não consegue responder de cabeça hoje — a lacuna costuma ser, ela própria, o diagnóstico.',
    ],
    suggestedSkills: ['CONTROLLER', 'STARTUPS', 'B2B_NETWORKING'],
  };
}

/** Builds the written analysis. It only ever asserts things the text supports. */
function buildSummary(
  scores: Record<GrowthPillar, number>,
  weakest: GrowthPillar,
  byPillar: Record<GrowthPillar, MatchedSignal[]>,
  firstRecommendation: string,
): string {
  const weakestMatches = [...byPillar[weakest]].sort((a, b) => b.signal.severity - a.signal.severity);
  const primary = weakestMatches[0];
  // Prefer a second signal that lives in a DIFFERENT sentence: re-quoting the
  // same line twice reads like a template filling itself in, which is exactly
  // the impression this analyser has to avoid.
  const secondary =
    weakestMatches.slice(1).find((m) => m.quote !== primary.quote) ?? weakestMatches[1];
  const secondaryIsSameSentence = secondary !== undefined && secondary.quote === primary.quote;

  const strongest = [...PILLAR_ORDER].sort((a, b) => scores[b] - scores[a])[0];
  const runnerUp = [...PILLAR_ORDER]
    .filter((p) => p !== weakest && byPillar[p].length > 0)
    .sort((a, b) => scores[a] - scores[b])[0];
  const untouched = PILLAR_ORDER.filter((p) => byPillar[p].length === 0);

  const parts: string[] = [];

  parts.push(
    `${PILLAR_LABELS[weakest]} é o pilar mais frágil da sua operação hoje: ${scores[weakest]}/100, contra ` +
      `${scores[strongest]}/100 em ${PILLAR_LABELS[strongest]}. O que puxou esse número foi o que você mesmo escreveu — ` +
      `“${primary.quote}”. ${primary.signal.insight}`,
  );

  if (secondary) {
    const lead = secondaryIsSameSentence
      ? `Nessa mesma frase aparece ${secondary.signal.label}.`
      : `Some a isso ${secondary.signal.label}, que aparece quando você diz “${secondary.quote}”.`;
    parts.push(
      `${lead} ${secondary.signal.insight} Os dois juntos explicam por que ${PILLAR_LABELS[weakest]} ficou ` +
        'abaixo dos outros pilares: não é um problema isolado, é um padrão que se repete na semana.',
    );
  }

  if (runnerUp) {
    const runnerUpMatches = [...byPillar[runnerUp]].sort((a, b) => b.signal.severity - a.signal.severity);
    parts.push(
      `${PILLAR_LABELS[runnerUp]} vem logo atrás (${scores[runnerUp]}/100), puxada por ` +
        `${runnerUpMatches
          .slice(0, 2)
          .map((m) => m.signal.label)
          .join(' e ')} — trate depois de estabilizar ${PILLAR_LABELS[weakest]}, ou você divide a atenção entre duas frentes e não resolve nenhuma.`,
    );
  }

  if (untouched.length > 0) {
    const names = untouched.map((p) => PILLAR_LABELS[p]);
    const joined =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
    parts.push(
      `${joined} ${untouched.length === 1 ? 'não apareceu' : 'não apareceram'} no seu relato e ` +
        `${untouched.length === 1 ? 'ficou' : 'ficaram'} na linha de base (${BASELINE}/100). Isso quer dizer "sem evidência", ` +
        'não "está resolvido" — este diagnóstico só pontua o que você descreveu.',
    );
  }

  // Lowercased so the recommendation reads as one sentence with the lead-in
  // rather than as a heading dropped after a colon.
  const firstStep = firstRecommendation.charAt(0).toLowerCase() + firstRecommendation.slice(1);
  parts.push(`O primeiro passo é objetivo: ${firstStep}`);

  return parts.join('\n\n');
}

/**
 * Reads a manager's plain-text description of their business problem and
 * produces the same shape the model path produces.
 */
export function analyzeSituation(situation: string): AnalyzedDiagnostic {
  const matches = findMatches(situation);
  if (matches.length === 0) return genericReading(situation);

  const matchesByPillar: Record<GrowthPillar, MatchedSignal[]> = {
    VENDAS: [],
    GESTAO: [],
    TECNOLOGIA: [],
    FINANCAS: [],
  };
  for (const match of matches) matchesByPillar[match.signal.pillar].push(match);

  const signalsByPillar = {
    VENDAS: matchesByPillar.VENDAS.map((m) => m.signal),
    GESTAO: matchesByPillar.GESTAO.map((m) => m.signal),
    TECNOLOGIA: matchesByPillar.TECNOLOGIA.map((m) => m.signal),
    FINANCAS: matchesByPillar.FINANCAS.map((m) => m.signal),
  };

  const scores: Record<GrowthPillar, number> = {
    VENDAS: scoreFor(signalsByPillar.VENDAS),
    GESTAO: scoreFor(signalsByPillar.GESTAO),
    TECNOLOGIA: scoreFor(signalsByPillar.TECNOLOGIA),
    FINANCAS: scoreFor(signalsByPillar.FINANCAS),
  };

  const weakest = pickWeakestPillar(scores, signalsByPillar);

  // Everything the manager is told to do, and everyone they could be matched
  // with, is ordered weakest-pillar-first: the diagnostic's whole job is to
  // say which single front to open.
  const ranked = [...matches].sort((a, b) => {
    const pillarDelta = scores[a.signal.pillar] - scores[b.signal.pillar];
    if (pillarDelta !== 0) return pillarDelta;
    return b.signal.severity - a.signal.severity;
  });

  const recommendations = unique(ranked.map((m) => m.signal.recommendation)).slice(0, MAX_RECOMMENDATIONS);

  const suggestedSkills = unique([
    ...ranked.flatMap((m) => m.signal.skills),
    ...PILLAR_DEFAULT_SKILLS[weakest],
  ]).slice(0, MAX_SUGGESTED_SKILLS);

  return {
    scores,
    weakestPillar: weakest,
    summary: buildSummary(scores, weakest, matchesByPillar, recommendations[0]),
    recommendations,
    suggestedSkills,
  };
}
