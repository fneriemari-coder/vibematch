import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleCategory } from '@prisma/client';
import { LazyOpenAI } from '../../common/ai/lazy-openai';
import { GenerateArticleDto } from './dto/generate-article.dto';

/** What a generator (model or local fallback) has to hand back to be persisted. */
export interface GeneratedArticle {
  title: string;
  excerpt: string;
  /** Markdown. */
  body: string;
}

const ARTICLE_SCHEMA = {
  name: 'editorial_article',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Título editorial em português, específico e sem clickbait — 6 a 14 palavras.',
      },
      excerpt: {
        type: 'string',
        description: 'Resumo de 2 a 3 frases que explica a promessa concreta do artigo.',
      },
      body: {
        type: 'string',
        description:
          'Artigo completo em markdown, 700-1100 palavras: abertura, seções ## , um framework numerado, ' +
          'um checklist com "- [ ]", métricas de acompanhamento e um fechamento acionável. Sem H1 (o título é renderizado separadamente).',
      },
    },
    required: ['title', 'excerpt', 'body'],
    additionalProperties: false,
  },
} as const;

/** Editorial identity of each vertical — drives both the model prompt and the local fallback. */
interface CategoryProfile {
  label: string;
  /** Who the piece is written for. */
  audience: string;
  frameworkName: string;
  steps: Array<{ name: string; text: string }>;
  symptoms: string[];
  checklist: string[];
  metrics: Array<{ name: string; text: string }>;
  pitfall: string;
}

const CATEGORY_PROFILES: Record<ArticleCategory, CategoryProfile> = {
  GESTAO: {
    label: 'Gestão',
    audience: 'donos e diretores de empresas de 10 a 200 pessoas',
    frameworkName: 'CICLO DE OPERAÇÃO',
    steps: [
      {
        name: 'Mapeie o processo real, não o desenhado',
        text: 'Acompanhe uma entrega do começo ao fim e cronometre cada etapa. O processo que existe no fluxograma quase nunca é o processo que a equipe executa, e é o segundo que produz o resultado.',
      },
      {
        name: 'Isole o gargalo único',
        text: 'Em qualquer operação existe um recurso que limita a vazão de todos os outros. Some o tempo de fila antes de cada etapa: o gargalo é onde o trabalho espera mais, não onde a equipe reclama mais.',
      },
      {
        name: 'Padronize antes de automatizar',
        text: 'Automatizar um processo instável só acelera o erro. Escreva o padrão em uma página, rode por duas semanas com a equipe seguindo à risca e só então compre ferramenta.',
      },
      {
        name: 'Instale o ritmo de revisão',
        text: 'Uma reunião semanal de 30 minutos com três números na tela vale mais que um dashboard que ninguém abre. O ritmo é o que transforma o padrão em hábito.',
      },
    ],
    symptoms: [
      'as decisões operacionais sobem todas para a mesma pessoa',
      'o time entrega no prazo apenas quando alguém "empurra"',
      'ninguém consegue dizer, sem abrir uma planilha, quanto custa entregar um pedido',
    ],
    checklist: [
      'Escolher UM processo crítico para atacar neste mês',
      'Cronometrar as etapas desse processo em três execuções reais',
      'Identificar o gargalo pelo tempo de fila, não pela percepção',
      'Escrever o padrão em uma página, com dono e prazo por etapa',
      'Definir os três indicadores que a reunião semanal vai olhar',
      'Rodar duas semanas sem mudar nada além do padrão',
      'Revisar o resultado e só então decidir o que automatizar',
    ],
    metrics: [
      { name: 'Lead time', text: 'tempo entre o pedido entrar e a entrega ser aceita pelo cliente.' },
      { name: 'Retrabalho', text: 'percentual de entregas que voltam para correção.' },
      { name: 'Custo por entrega', text: 'custo total da operação dividido pelo número de entregas do período.' },
    ],
    pitfall: 'comprar um sistema novo antes de ter o processo estável — a ferramenta apenas registra o caos mais rápido',
  },
  VENDAS: {
    label: 'Vendas',
    audience: 'fundadores e líderes comerciais que ainda dependem demais do próprio esforço',
    frameworkName: 'FUNIL DE PREVISIBILIDADE',
    steps: [
      {
        name: 'Defina o cliente que você quer repetir',
        text: 'Liste os dez melhores contratos dos últimos doze meses e procure o que eles têm em comum: porte, setor, gatilho de compra. É esse recorte, e não "todo mundo que precisa", que define a prospecção.',
      },
      {
        name: 'Separe geração de demanda de fechamento',
        text: 'Quem prospecta e quem fecha usam habilidades diferentes. Enquanto a mesma pessoa faz as duas coisas, a agenda de fechamento sempre come o tempo de prospecção e o mês seguinte fica vazio.',
      },
      {
        name: 'Documente a conversa que fecha',
        text: 'Grave e transcreva as reuniões que viraram contrato. As mesmas cinco perguntas aparecem sempre — transforme-as em um roteiro para que o resultado não dependa de talento individual.',
      },
      {
        name: 'Feche o ciclo com o pós-venda',
        text: 'O melhor canal de aquisição de um negócio de serviço é o cliente satisfeito. Coloque um pedido de indicação como etapa formal do processo, com data e responsável.',
      },
    ],
    symptoms: [
      'o mês fecha bem ou mal dependendo de quantas reuniões o fundador conseguiu fazer',
      'a proposta é reescrita do zero a cada oportunidade',
      'a equipe não sabe dizer por que uma negociação foi perdida',
    ],
    checklist: [
      'Listar os dez melhores contratos do último ano e extrair o padrão',
      'Escrever em uma frase o problema que você resolve melhor que qualquer um',
      'Separar na agenda blocos fixos de prospecção que não podem ser remarcados',
      'Padronizar a proposta comercial em um modelo com preço e escopo claros',
      'Registrar o motivo real de cada perda no CRM, em texto livre',
      'Revisar semanalmente a taxa de conversão por etapa do funil',
      'Transformar o pedido de indicação em etapa obrigatória do pós-venda',
    ],
    metrics: [
      { name: 'Taxa de conversão por etapa', text: 'quantos avançam de reunião para proposta e de proposta para contrato.' },
      { name: 'Ciclo de venda', text: 'dias entre o primeiro contato e a assinatura.' },
      { name: 'Ticket médio', text: 'receita fechada dividida pelo número de contratos do período.' },
    ],
    pitfall: 'aumentar o volume de prospecção antes de corrigir a taxa de conversão — você só terá mais gente para perder',
  },
  LIDERANCA: {
    label: 'Liderança',
    audience: 'líderes que acabaram de assumir um time ou cresceram junto com a empresa',
    frameworkName: 'CONTRATO DE LIDERANÇA',
    steps: [
      {
        name: 'Torne o combinado explícito',
        text: 'A maior parte dos conflitos de time nasce de expectativa não dita. Escreva, com cada liderado, o que significa um bom trimestre para a posição dele — em resultado, não em esforço.',
      },
      {
        name: 'Dê feedback no ciclo curto',
        text: 'Feedback guardado para a avaliação semestral chega tarde demais para mudar qualquer coisa. Fale em até 48 horas, sobre o comportamento observável e o efeito que ele causou.',
      },
      {
        name: 'Delegue a decisão, não só a tarefa',
        text: 'Delegar tarefa mantém você no centro. Delegue a decisão, defina o limite de risco aceitável e combine em que ponto a pessoa deve te procurar.',
      },
      {
        name: 'Proteja o tempo de pensar',
        text: 'Um líder cuja agenda está 100% ocupada com reuniões não está liderando, está reagindo. Bloqueie duas horas semanais para trabalho de planejamento e trate esse bloco como inegociável.',
      },
    ],
    symptoms: [
      'todo mundo pede aprovação para decisões de baixo impacto',
      'os problemas só aparecem quando já viraram crise',
      'as pessoas boas saem sem que você tenha visto vindo',
    ],
    checklist: [
      'Escrever o que é um bom trimestre para cada posição do time',
      'Agendar uma conversa individual quinzenal de 30 minutos com cada liderado',
      'Dar um feedback específico em até 48 horas do fato observado',
      'Listar as decisões que você ainda toma e que poderiam ser delegadas',
      'Definir o limite de risco em que a pessoa deve te consultar',
      'Bloquear duas horas semanais de trabalho de planejamento na agenda',
      'Perguntar em cada individual o que está atrapalhando a entrega',
    ],
    metrics: [
      { name: 'Rotatividade voluntária', text: 'quantas pessoas boas pediram para sair nos últimos doze meses.' },
      { name: 'Decisões escaladas', text: 'quantas decisões chegaram até você que poderiam ter parado antes.' },
      { name: 'Prazo de entrega combinado', text: 'percentual de compromissos do time cumpridos na data acordada.' },
    ],
    pitfall: 'confundir proximidade com liderança — ser querido não substitui deixar claro o que se espera',
  },
  ESTRATEGIA: {
    label: 'Estratégia',
    audience: 'sócios e conselheiros que precisam escolher onde não competir',
    frameworkName: 'TESE DE CRESCIMENTO',
    steps: [
      {
        name: 'Escreva a escolha, não o desejo',
        text: 'Estratégia é o que você decide não fazer. Um plano que promete crescer em todos os segmentos, com todos os produtos, para todos os públicos, não é uma estratégia — é uma lista de vontades.',
      },
      {
        name: 'Ancore na vantagem que você já tem',
        text: 'Vantagem competitiva raramente é inventada; ela é reconhecida. Pergunte por que os clientes atuais escolheram você e por que os que ficaram, ficaram.',
      },
      {
        name: 'Teste a tese com o menor experimento possível',
        text: 'Antes de reorganizar a empresa em torno de uma aposta, encontre o teste mais barato que consegue invalidá-la. Defina de antemão qual resultado te faria desistir.',
      },
      {
        name: 'Traduza em três iniciativas com dono',
        text: 'Uma tese sem iniciativa é slide. Escolha no máximo três frentes por trimestre, cada uma com um dono, uma métrica e uma data.',
      },
    ],
    symptoms: [
      'o plano do ano tem mais de dez prioridades',
      'a empresa entra em um segmento novo a cada semestre e não termina nenhum',
      'ninguém no time consegue explicar a estratégia em duas frases',
    ],
    checklist: [
      'Escrever a estratégia em duas frases e testar com três pessoas do time',
      'Listar explicitamente o que a empresa NÃO vai fazer neste ano',
      'Levantar por que os dez maiores clientes escolheram a empresa',
      'Definir a aposta central e a evidência que a invalidaria',
      'Desenhar o menor experimento capaz de gerar essa evidência',
      'Escolher no máximo três iniciativas trimestrais, com dono e métrica',
      'Marcar a revisão de meio de trimestre antes que o trimestre comece',
    ],
    metrics: [
      { name: 'Concentração de receita', text: 'percentual do faturamento vindo do segmento escolhido como aposta.' },
      { name: 'Iniciativas concluídas', text: 'quantas das três frentes do trimestre chegaram ao fim.' },
      { name: 'Margem de contribuição por segmento', text: 'quanto sobra depois dos custos diretos, por linha de negócio.' },
    ],
    pitfall: 'tratar orçamento como estratégia — planilha organiza recursos, não define onde você vai vencer',
  },
  MARKETING: {
    label: 'Marketing',
    audience: 'times pequenos que precisam gerar demanda sem orçamento de grande anunciante',
    frameworkName: 'MOTOR DE DEMANDA',
    steps: [
      {
        name: 'Escolha uma dor, não um público',
        text: 'Comunicação genérica não compete com comunicação específica. Fale de um problema reconhecível na primeira frase e deixe o público se identificar sozinho.',
      },
      {
        name: 'Construa um ativo, não uma campanha',
        text: 'Campanha para quando o orçamento acaba; ativo continua trabalhando. Um conteúdo de referência, uma calculadora ou um diagnóstico geram demanda por meses.',
      },
      {
        name: 'Feche o caminho até a conversa',
        text: 'A maior perda de marketing em serviço não está no topo, está no meio: alguém interessado que não sabe qual é o próximo passo. Deixe uma única ação óbvia em cada peça.',
      },
      {
        name: 'Meça o que vira receita',
        text: 'Alcance e curtida não pagam folha. Amarre cada canal ao número de conversas qualificadas geradas e corte o que não produz.',
      },
    ],
    symptoms: [
      'a empresa produz muito conteúdo e gera pouca conversa comercial',
      'cada peça fala de um posicionamento diferente',
      'ninguém sabe dizer qual canal trouxe os clientes do último trimestre',
    ],
    checklist: [
      'Escrever a dor central em uma frase que o cliente usaria',
      'Escolher um único canal para dominar nos próximos 90 dias',
      'Produzir um ativo de referência com profundidade real sobre o tema',
      'Colocar uma única chamada para ação clara em cada peça',
      'Registrar a origem de cada oportunidade que entra',
      'Revisar mensalmente conversas qualificadas por canal',
      'Cortar o canal que não gerou conversa em dois ciclos seguidos',
    ],
    metrics: [
      { name: 'Conversas qualificadas', text: 'número de reuniões com quem tem problema, orçamento e urgência.' },
      { name: 'Custo por conversa qualificada', text: 'investimento no canal dividido por essas reuniões.' },
      { name: 'Receita por origem', text: 'quanto cada canal fechou, não quanto cada canal atraiu.' },
    ],
    pitfall: 'trocar de canal a cada dois meses antes de qualquer um ter tempo de amadurecer',
  },
  FINANCAS: {
    label: 'Finanças',
    audience: 'empresas que faturam bem e mesmo assim vivem apertadas de caixa',
    frameworkName: 'CAIXA SOB CONTROLE',
    steps: [
      {
        name: 'Separe lucro de caixa',
        text: 'Dar lucro e ter dinheiro em conta são coisas diferentes. Lucro é competência do período; caixa é quando o dinheiro entra e sai de verdade — e é o caixa que quebra empresa.',
      },
      {
        name: 'Construa o fluxo de 13 semanas',
        text: 'Projete entradas e saídas semana a semana pelos próximos três meses. É o horizonte curto o suficiente para ser confiável e longo o suficiente para dar tempo de reagir.',
      },
      {
        name: 'Ataque o ciclo financeiro',
        text: 'Some prazo de recebimento e estoque, subtraia prazo de pagamento. Cada dia cortado desse ciclo devolve dinheiro ao caixa sem precisar de banco.',
      },
      {
        name: 'Defina a reserva mínima operacional',
        text: 'Estabeleça quantas semanas de custo fixo a empresa mantém em caixa e trate esse piso como cláusula, não como meta. Abaixo dele, decisões de investimento ficam suspensas.',
      },
    ],
    symptoms: [
      'o resultado do mês é positivo mas a conta está no limite',
      'a empresa desconta recebível recorrentemente para fechar a folha',
      'ninguém sabe qual produto ou cliente dá margem de verdade',
    ],
    checklist: [
      'Separar contas: pessoa física, pessoa jurídica e reserva',
      'Montar o fluxo de caixa das próximas 13 semanas',
      'Levantar prazo médio de recebimento e de pagamento',
      'Calcular a margem de contribuição por linha de produto ou serviço',
      'Definir a reserva mínima em semanas de custo fixo',
      'Revisar o fluxo toda segunda-feira, com número real, não estimado',
      'Renegociar o prazo dos três maiores fornecedores',
    ],
    metrics: [
      { name: 'Ciclo financeiro', text: 'prazo de recebimento mais estoque menos prazo de pagamento, em dias.' },
      { name: 'Reserva de caixa', text: 'quantas semanas de custo fixo a empresa consegue sustentar hoje.' },
      { name: 'Margem de contribuição', text: 'quanto sobra de cada real vendido depois dos custos variáveis.' },
    ],
    pitfall: 'confundir faturamento com saúde — crescer vendendo com margem negativa apenas acelera o problema',
  },
  TECNOLOGIA: {
    label: 'Tecnologia',
    audience: 'empresas que já dependem de software para operar, mas não têm time técnico grande',
    frameworkName: 'ADOÇÃO COM RETORNO',
    steps: [
      {
        name: 'Comece pelo processo mais caro, não pelo mais novo',
        text: 'A tecnologia certa é a que ataca a tarefa que mais consome hora de gente qualificada. Levante onde o time gasta tempo antes de olhar qualquer ferramenta.',
      },
      {
        name: 'Prove em um recorte pequeno',
        text: 'Escolha um processo, um time e 30 dias. Um piloto pequeno com medição honesta ensina mais do que uma implantação ampla que ninguém consegue avaliar.',
      },
      {
        name: 'Integre com o que já existe',
        text: 'Ferramenta que não conversa com o sistema atual vira digitação dupla e morre em três meses. Verifique integração antes de assinar contrato, não depois.',
      },
      {
        name: 'Documente e transfira o conhecimento',
        text: 'Se só uma pessoa sabe operar a automação, você trocou um gargalo por outro. Escreva o passo a passo e treine um segundo responsável desde o início.',
      },
    ],
    symptoms: [
      'a mesma informação é digitada em dois sistemas diferentes',
      'toda automação depende de uma única pessoa',
      'a empresa assina ferramentas que ninguém usa depois de dois meses',
    ],
    checklist: [
      'Mapear onde o time gasta mais horas repetitivas por semana',
      'Escolher um único processo para o piloto de 30 dias',
      'Definir a métrica de sucesso antes de começar o piloto',
      'Confirmar a integração com os sistemas atuais',
      'Rodar o piloto medindo horas economizadas de verdade',
      'Documentar o passo a passo operacional em texto',
      'Treinar um segundo responsável antes de expandir',
    ],
    metrics: [
      { name: 'Horas recuperadas', text: 'horas por semana que deixaram de ser gastas na tarefa manual.' },
      { name: 'Taxa de adoção', text: 'percentual do time que usa a ferramenta semanalmente.' },
      { name: 'Custo por processo automatizado', text: 'licença mais implantação dividido pelo ganho mensal.' },
    ],
    pitfall: 'automatizar um processo ruim — a única coisa que escala é o erro',
  },
  CARREIRA: {
    label: 'Carreira',
    audience: 'profissionais em transição de especialista para líder, ou de emprego para negócio próprio',
    frameworkName: 'CAPITAL PROFISSIONAL',
    steps: [
      {
        name: 'Escolha o problema que você quer ser chamado para resolver',
        text: 'Reputação profissional não se constrói em torno de um cargo, e sim de um problema. Defina qual é o seu e diga em voz alta, repetidamente, para as pessoas certas.',
      },
      {
        name: 'Transforme entrega em evidência',
        text: 'Resultado que ninguém consegue verificar não vira oportunidade. Registre número, contexto e o antes e depois de cada entrega relevante enquanto ainda está fresco.',
      },
      {
        name: 'Construa rede antes de precisar',
        text: 'A rede que funciona é a que foi cultivada quando você não estava pedindo nada. Ofereça ajuda concreta a cinco pessoas por mês, sem pedir contrapartida.',
      },
      {
        name: 'Renegocie com dados, não com sentimento',
        text: 'Chegue à conversa de promoção ou de preço com evidência de impacto e referência de mercado. O argumento "estou há muito tempo aqui" não move ninguém.',
      },
    ],
    symptoms: [
      'você entrega muito e mesmo assim é lembrado pouco',
      'as oportunidades que aparecem não são as que você quer',
      'sua descrição profissional muda dependendo de quem pergunta',
    ],
    checklist: [
      'Escrever em uma frase o problema que você resolve melhor',
      'Listar as cinco entregas mais relevantes dos últimos dois anos, com números',
      'Atualizar o material público (perfil, portfólio) com essas evidências',
      'Escolher cinco pessoas por mês para ajudar sem pedir nada',
      'Pedir feedback direto a dois pares e a um gestor',
      'Levantar a referência de mercado da sua posição',
      'Marcar a conversa de renegociação com data e pauta escritas',
    ],
    metrics: [
      { name: 'Convites recebidos', text: 'quantas oportunidades chegaram até você sem que você procurasse.' },
      { name: 'Evidências registradas', text: 'número de entregas documentadas com resultado mensurável.' },
      { name: 'Alcance da rede ativa', text: 'quantas conversas relevantes você teve fora da sua empresa no trimestre.' },
    ],
    pitfall: 'esperar que o bom trabalho fale por si — ele fala, mas só para quem estava olhando',
  },
};

/**
 * Writes an editorial article for a user. Two paths, in this order:
 *
 *  1. The real model, via LazyOpenAI (never constructed at module scope, so a
 *     missing OPENAI_API_KEY can't take the app's boot down with it).
 *  2. A deterministic local composer.
 *
 * Path 2 is not a stub. `POST /content/generate-article` must return a real,
 * publishable article whether or not the key is configured — the product is
 * demoed before the key is bought, and an endpoint that 503s on a demo is
 * worse than no endpoint. So the fallback composes a genuinely structured
 * piece from the category's editorial profile above: diagnosis, a named
 * framework, a 30-day plan, a checklist, the metrics to watch and a closing
 * takeaway. It is the path that will actually run today.
 */
@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);
  private readonly openai: LazyOpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new LazyOpenAI(this.config.get('OPENAI_API_KEY'), this.logger, 'AI article generation');
    this.model = this.config.get('OPENAI_INTENT_MODEL') ?? 'gpt-4o-mini';
  }

  async compose(dto: GenerateArticleDto): Promise<GeneratedArticle> {
    if (!this.openai.isConfigured) {
      this.logger.warn('OPENAI_API_KEY absent — composing article locally');
      return this.composeLocally(dto);
    }

    try {
      return await this.composeWithModel(dto);
    } catch (err) {
      this.logger.warn(
        `Model article generation failed (${(err as Error).message}) — falling back to the local composer`,
      );
      return this.composeLocally(dto);
    }
  }

  private async composeWithModel(dto: GenerateArticleDto): Promise<GeneratedArticle> {
    const profile = CATEGORY_PROFILES[dto.category];

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.7,
      response_format: { type: 'json_schema', json_schema: ARTICLE_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'Você é o editor-chefe de uma publicação brasileira de negócios lida por ' +
            `${profile.audience}. Escreva em português do Brasil, tom pragmático e direto, ` +
            'sempre com exemplo concreto e número quando possível. Proibido: encher linguiça, ' +
            'promessa vazia, jargão sem definição e frase de efeito sem instrução prática. ' +
            'O artigo precisa ter seções em markdown (##), um framework numerado, um checklist ' +
            'com "- [ ]" e um fechamento acionável.',
        },
        {
          role: 'user',
          content:
            `Tema: ${dto.topic}\nEditoria: ${profile.label}\n` +
            `Framework de referência da editoria: ${profile.frameworkName}.\n` +
            'Escreva o artigo completo.',
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty completion from OpenAI while generating article');

    const parsed = JSON.parse(raw) as GeneratedArticle;
    if (!parsed.title?.trim() || !parsed.excerpt?.trim() || !parsed.body?.trim()) {
      throw new Error('Model returned an article with an empty field');
    }
    return parsed;
  }

  /**
   * Deterministic composer — same topic + category always yields the same
   * article. Reads as an opinionated editor applying the vertical's house
   * framework to whatever the author asked about.
   */
  private composeLocally(dto: GenerateArticleDto): GeneratedArticle {
    const profile = CATEGORY_PROFILES[dto.category];
    const topic = this.normalizeTopic(dto.topic);

    const title = `${topic}: o roteiro prático de ${profile.label.toLowerCase()} para sair do improviso`;

    const excerpt =
      `Quase toda empresa que trava em ${topic.toLowerCase()} não trava por falta de esforço, e sim por falta de método. ` +
      `Este guia aplica o framework ${profile.frameworkName} ao tema, com um plano de 30 dias, um checklist de execução ` +
      'e os três números que dizem se está funcionando.';

    const steps = profile.steps
      .map((step, i) => `${i + 1}. **${step.name}** — ${step.text}`)
      .join('\n');

    const symptoms = profile.symptoms.map((s) => `- ${this.capitalize(s)}.`).join('\n');
    const checklist = profile.checklist.map((c) => `- [ ] ${c}`).join('\n');
    const metrics = profile.metrics.map((m) => `- **${m.name}** — ${m.text}`).join('\n');

    const body = [
      `Quando um time diz que precisa "melhorar ${topic.toLowerCase()}", quase sempre o que falta não é ` +
        'vontade nem informação. Falta uma sequência: o que atacar primeiro, o que só faz sentido depois, ' +
        'e como saber que o esforço está produzindo resultado. Sem essa sequência, cada mês recomeça do zero ' +
        'e a sensação é de correr muito para chegar ao mesmo lugar.',

      `Este artigo é escrito para ${profile.audience}. Ele usa o framework ${profile.frameworkName} — quatro ` +
        `passos em ordem — e termina com o plano dos próximos 30 dias, o checklist e as métricas de acompanhamento.`,

      '## Como você sabe que o problema é esse',
      'Três sinais aparecem antes de o custo ficar visível na planilha:',
      symptoms,
      'Se dois dos três descrevem a sua realidade hoje, o problema é de método, não de esforço — e método se corrige em semanas.',

      `## O framework ${profile.frameworkName}`,
      'A ordem importa mais do que a execução perfeita de cada passo. Pular o primeiro para chegar ao terceiro é o erro mais comum.',
      steps,

      '## O plano dos próximos 30 dias',
      `**Semana 1 — diagnóstico.** ${profile.steps[0].name}. Não mude nada ainda; a única entrega da semana é enxergar o estado real.`,
      `**Semana 2 — recorte.** ${profile.steps[1].name}. Escolha um único ponto de ataque e resista à tentação de resolver tudo de uma vez.`,
      `**Semana 3 — padrão.** ${profile.steps[2].name}. Escreva o combinado em uma página e coloque para rodar com a equipe.`,
      `**Semana 4 — ritmo.** ${profile.steps[3].name}. Estabeleça a revisão recorrente e mantenha os números na mesma tela toda semana.`,
      'Trinta dias não resolvem o tema inteiro, e não é essa a proposta. O que eles entregam é a primeira volta completa do ciclo — ' +
        'e a partir daí cada volta seguinte fica mais barata.',

      '## Checklist de execução',
      checklist,

      '## O que medir',
      'Três números, revisados semanalmente, bastam. Mais que isso vira relatório que ninguém lê:',
      metrics,

      '## O erro que mais custa caro',
      `O erro clássico aqui é ${profile.pitfall}. Ele é sedutor porque parece progresso — há movimento, há gasto, ` +
        'há reunião — mas o indicador não se mexe. A pergunta que evita esse desperdício é simples: qual número ' +
        'vai mudar por causa desta decisão, e em quanto tempo?',

      '## O que fazer amanhã de manhã',
      `Escolha o primeiro item do checklist e coloque uma data nele. ${topic} não melhora por decisão de planejamento anual; ` +
        'melhora quando alguém assume um recorte pequeno, com prazo curto, e mede o resultado sem maquiar. ' +
        'Faça a primeira volta do ciclo, revise o que aprendeu e comece a segunda. É essa repetição — e não a próxima ' +
        'ferramenta, nem a próxima contratação — que separa a empresa que evolui da que apenas se ocupa.',
    ].join('\n\n');

    return { title, excerpt, body };
  }

  /** Trims and de-capitalizes an all-caps topic so it reads naturally inside a sentence. */
  private normalizeTopic(topic: string): string {
    const trimmed = topic.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
    const normalized = trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed;
    return this.capitalize(normalized);
  }

  private capitalize(text: string): string {
    return text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }
}
