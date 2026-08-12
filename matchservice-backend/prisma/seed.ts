import {
  PrismaClient,
  ArticleCategory,
  ArticleStatus,
  CommunityTier,
  Currency,
  GrowthPillar,
  MembershipStatus,
  NewsCategory,
  NewsMediaKind,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED_PASSWORD_HASH = bcrypt.hashSync('MatchService#Seed2026', 12);

interface SeedCreator {
  key: string;
  email: string;
  name: string;
  country: string;
  role: Role;
  bio: string;
  skills: string[];
  b2bNetworking?: boolean;
}

interface SeedPost {
  creatorKey: string;
  daysAgo: number; // 6 = Dia 1 (oldest), 0 = Dia 7 (today) — spreads the 7-day launch timeline
  title: string;
  contentText: string;
  mediaUrl: string;
  videoDurationSeconds?: number;
  likesCount: number;
  viewsCount: number;
  tags: string[];
}

interface SeedCourse {
  instructorKey: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  skillsTaught: string[];
  modules: string[];
}

interface SeedMastermind {
  hostKey: string;
  title: string;
  accessFee: number;
  daysFromNow: number;
}

/** Curated mentor group surfaced by GET /academy/mentors. */
interface SeedMentor {
  creatorKey: string;
  headline: string;
  topics: string[];
  /** ProviderScore.financialHealthScore — the K-SCORE the directory ranks on. */
  kScore: number;
}

/**
 * A mentor's paid one-to-one product plus the calendar it is sold against.
 * `slotOffsets` are resolved against the seed's own `now`, so a fresh database
 * always has bookable future slots — an offering with only past slots is
 * invisible to GET /mentorship/offerings by design.
 */
interface SeedMentorshipOffering {
  mentorKey: string;
  title: string;
  description: string;
  durationMinutes: number;
  price: number;
  topics: string[];
  slotOffsets: Array<{ daysFromNow: number; hour: number }>;
}

/**
 * A stored radar reading. `situation` is written the way a manager actually
 * types it — a paragraph of symptoms, not a form — and the scores, summary,
 * recommendations and skills below are the exact output the local growth
 * analyser (src/modules/diagnostics/growth-analyzer.ts) produces for that
 * text. They are transcribed rather than computed so this file stays
 * self-contained and `npm run build:seed` keeps compiling on its own.
 */
interface SeedDiagnostic {
  userKey: string;
  situation: string;
  scores: { vendas: number; gestao: number; tecnologia: number; financas: number };
  weakestPillar: GrowthPillar;
  summary: string;
  recommendations: string[];
  suggestedSkills: string[];
  daysAgo: number;
}

interface SeedArticle {
  authorKey: string;
  category: ArticleCategory;
  title: string;
  excerpt: string;
  /** Markdown. Rendered by the client; kept here as the real launch copy. */
  body: string;
  daysAgo: number;
  viewCount: number;
}

interface SeedCommunity {
  key: string;
  hostKey: string;
  tier: CommunityTier;
  name: string;
  tagline: string;
  description: string;
  monthlyFee: number;
  seatLimit: number;
  cadence: string;
  minKScore: number;
  focusTopics: string[];
}

interface SeedMembership {
  communityKey: string;
  memberKey: string;
  askedCount: number;
  answeredCount: number;
}

/**
 * A curated public RSS/Atom endpoint for the Radar feed. `category` and
 * `mediaKind` are OUR editorial decision about the publisher, not something
 * read out of the feed — publishers' own tags are inconsistent and untrusted.
 */
interface SeedNewsSource {
  name: string;
  feedUrl: string;
  siteUrl: string;
  category: NewsCategory;
  mediaKind?: NewsMediaKind;
  language?: string;
}

const CREATORS: SeedCreator[] = [
  {
    key: 'ai_dev_br',
    email: 'seed.creator.ai@matchservice.dev',
    name: 'Rafael Kimura',
    country: 'BR',
    role: Role.PROVIDER,
    bio: 'AI automation builder — Make.com, Vapi, GPT integrations for US and BR clients.',
    skills: ['AI_AUTOMATION', 'MAKE', 'SaaS'],
  },
  {
    key: 'floor_installer_br',
    email: 'seed.creator.floors@matchservice.dev',
    name: 'Marcos Aurélio Silva',
    country: 'BR',
    role: Role.PROVIDER,
    bio: 'Instalador e restaurador de pisos — vinílico, laminado e porcelanato.',
    skills: ['FLOOR_INSTALLATION', 'LOCAL_SERVICE', 'MAINTENANCE'],
  },
  {
    key: 'video_editor_br',
    email: 'seed.creator.video@matchservice.dev',
    name: 'Juliana Prado',
    country: 'BR',
    role: Role.PROVIDER,
    bio: 'Short-form video editor for US brands — TikTok/Reels retention specialist.',
    skills: ['VIDEO_EDITING', 'SHORT_FORM'],
  },
  {
    key: 'growth_client_us',
    email: 'seed.client.growth@matchservice.dev',
    name: 'Derek Thompson',
    country: 'US',
    role: Role.CLIENT,
    bio: 'Growth agency founder in Austin, TX — scaling via technical partnerships.',
    skills: ['B2B_NETWORKING', 'STARTUPS'],
    b2bNetworking: true,
  },
  {
    key: 'uiux_designer_br',
    email: 'seed.creator.uiux@matchservice.dev',
    name: 'Camila Ferraz',
    country: 'BR',
    role: Role.PROVIDER,
    bio: 'Product designer — high-conversion SaaS dashboards and design systems.',
    skills: ['UI_UX', 'DESIGN'],
  },
  {
    key: 'plumber_br',
    email: 'seed.creator.plumbing@matchservice.dev',
    name: 'Edson Batista',
    country: 'BR',
    role: Role.PROVIDER,
    bio: 'Encanador — instalação e manutenção residencial, autoridade local.',
    skills: ['PLUMBING', 'LOCAL_SERVICE'],
  },
];

/**
 * VibeAcademy catalogue. Prices are in the instructor's own currency
 * (see CREATORS[].country) — the Academy list endpoint returns both, and the
 * client renders whichever the course carries.
 */
const COURSES: SeedCourse[] = [
  {
    instructorKey: 'ai_dev_br',
    title: 'Corrigindo Erros de Webhook do Stripe em 5 Minutos',
    description:
      'O plano de ação exato para parar de perder pagamento por webhook mal validado — do endpoint à verificação de assinatura, com retry seguro que não cobra duas vezes.',
    price: 197,
    rating: 4.9,
    skillsTaught: ['STRIPE_WEBHOOK', 'PAYMENTS', 'BACKEND'],
    modules: [
      'Por que o webhook falha silenciosamente',
      'Validando a assinatura corretamente',
      'Retry seguro sem cobrar duas vezes',
    ],
  },
  {
    instructorKey: 'ai_dev_br',
    title: 'Agentes de IA que Atendem Clientes 24h',
    description:
      'Monte um agente de voz que qualifica lead, agenda e responde no WhatsApp — integrando GPT, Vapi e seu CRM sem escrever backend do zero.',
    price: 397,
    rating: 4.8,
    skillsTaught: ['AI_AUTOMATION', 'MAKE', 'SaaS'],
    modules: [
      'Arquitetura de um agente que não alucina',
      'Conectando voz, WhatsApp e CRM',
      'Medindo qualificação e custo por lead',
    ],
  },
  {
    instructorKey: 'video_editor_br',
    title: 'A Regra dos 3 Segundos: Retenção em Vídeo Curto',
    description:
      'O gancho que dobrou a retenção de clientes americanos em TikTok e Reels — estrutura, corte e ritmo aplicados linha a linha.',
    price: 147,
    rating: 4.7,
    skillsTaught: ['VIDEO_EDITING', 'SHORT_FORM'],
    modules: [
      'Anatomia dos 3 primeiros segundos',
      'Ritmo de corte e retenção',
      'Testando ganchos sem refazer o vídeo',
    ],
  },
  {
    instructorKey: 'uiux_designer_br',
    title: 'Dashboards SaaS que Convertem sem Perder Velocidade',
    description:
      'Como redesenhar um painel para aumentar ativação sem sacrificar performance — hierarquia, densidade e as métricas que realmente importam.',
    price: 297,
    rating: 5.0,
    skillsTaught: ['UI_UX', 'DESIGN', 'SaaS'],
    modules: [
      'Densidade de informação sem ruído',
      'Estados vazios que ensinam',
      'Medindo ativação de verdade',
    ],
  },
];

/** Live Masterminds — all scheduled ahead of "now" so the upcoming list is never empty. */
const MASTERMINDS: SeedMastermind[] = [
  {
    hostKey: 'ai_dev_br',
    title: 'Mentoria ao vivo: automação de vendas com IA',
    accessFee: 89,
    daysFromNow: 3,
  },
  {
    hostKey: 'growth_client_us',
    title: 'Live Mastermind: scaling a US agency with BR talent',
    accessFee: 120,
    daysFromNow: 7,
  },
  {
    hostKey: 'uiux_designer_br',
    title: 'Mentoria: portfólio de design que fecha contrato',
    accessFee: 69,
    daysFromNow: 12,
  },
];

/**
 * The curated mentors group. Only these three carry `isMentor` — the whole
 * point of the directory is that it is editorial, not opt-in. The K-SCORE
 * values also make the directory's ranking (and the Círculos' `minKScore`
 * gate) observable on a fresh database.
 */
const MENTORS: SeedMentor[] = [
  {
    creatorKey: 'ai_dev_br',
    headline: 'Automação e agentes de IA para operações que não podem parar',
    topics: ['Automação de processos', 'Agentes de IA', 'Integração de sistemas', 'Operação enxuta'],
    kScore: 862,
  },
  {
    creatorKey: 'uiux_designer_br',
    headline: 'Produto e design para SaaS: ativação, retenção e times de design',
    topics: ['Design de produto', 'Ativação de usuários', 'Design system', 'Pesquisa com clientes'],
    kScore: 780,
  },
  {
    creatorKey: 'video_editor_br',
    headline: 'Conteúdo e aquisição: como marcas pequenas ganham atenção sem mídia paga',
    topics: ['Conteúdo em vídeo', 'Aquisição orgânica', 'Posicionamento', 'Time de criação'],
    kScore: 705,
  },
];

/**
 * One-to-one mentorship. Each curated mentor publishes exactly one offering,
 * priced in BRL and sold against a real calendar — GET /mentorship/offerings
 * only surfaces offerings that have at least one future free slot, so without
 * these the marketplace is empty on a fresh database.
 */
const MENTORSHIP_OFFERINGS: SeedMentorshipOffering[] = [
  {
    mentorKey: 'ai_dev_br',
    title: 'Sessão 1:1: onde automatizar primeiro na sua operação',
    description: 'Uma hora olhando a sua operação real, não um treinamento genérico. Você traz as tarefas que a sua equipe repete ' +
      'toda semana — orçamento digitado duas vezes, cadastro copiado de um sistema para outro, atendimento que só ' +
      'existe no WhatsApp de alguém — e saímos com as três primeiras automações em ordem de retorno, com o que dá ' +
      'para fazer sem trocar nenhum sistema. Traga print das telas que você usa e um número: quantas horas por ' +
      'semana essas tarefas consomem hoje.',
    durationMinutes: 60,
    price: 690,
    topics: ['Automação de processos', 'Agentes de IA', 'Integração de sistemas'],
    slotOffsets: [
      { daysFromNow: 4, hour: 9 },
      { daysFromNow: 4, hour: 14 },
      { daysFromNow: 6, hour: 10 },
      { daysFromNow: 9, hour: 16 },
      { daysFromNow: 13, hour: 9 },
    ],
  },
  {
    mentorKey: 'uiux_designer_br',
    title: 'Sessão 1:1: por que seu produto não ativa o cliente novo',
    description: 'Sessão de revisão de produto para quem já tem cliente entrando e perdendo na primeira semana. Passamos pelo seu ' +
      'fluxo de cadastro até o primeiro valor entregue, marcamos onde o usuário desiste e o que a tela está pedindo ' +
      'antes da hora. Você sai com um recorte do onboarding, a métrica de ativação que faz sentido para o seu caso e ' +
      'a lista do que remover — quase sempre o ganho está em tirar, não em acrescentar.',
    durationMinutes: 60,
    price: 590,
    topics: ['Ativação de usuários', 'Design de produto', 'Onboarding', 'Métricas de produto'],
    slotOffsets: [
      { daysFromNow: 3, hour: 11 },
      { daysFromNow: 5, hour: 15 },
      { daysFromNow: 8, hour: 9 },
      { daysFromNow: 11, hour: 14 },
    ],
  },
  {
    mentorKey: 'video_editor_br',
    title: 'Sessão 1:1: plano de conteúdo para quem não tem verba de mídia',
    description: 'Para quem precisa aparecer sem verba de mídia. Trazemos o que você já publicou (ou o que pretende publicar), ' +
      'escolhemos um único ângulo que só a sua empresa consegue defender e montamos o plano das quatro próximas ' +
      'semanas: formato, gancho dos três primeiros segundos e ritmo de corte. Saímos com dois roteiros prontos para ' +
      'gravar no celular e o critério para saber se está funcionando sem depender de viralizar.',
    durationMinutes: 45,
    price: 390,
    topics: ['Conteúdo em vídeo', 'Aquisição orgânica', 'Posicionamento'],
    slotOffsets: [
      { daysFromNow: 2, hour: 10 },
      { daysFromNow: 5, hour: 10 },
      { daysFromNow: 7, hour: 17 },
      { daysFromNow: 10, hour: 11 },
      { daysFromNow: 14, hour: 15 },
      { daysFromNow: 17, hour: 9 },
    ],
  },
];

/**
 * Two stored radar readings, so the diagnostics screen has history on a fresh
 * database. Both are written the way a manager actually types the problem —
 * a paragraph of symptoms — and every score, sentence and skill tag below is
 * verbatim output of the local growth analyser for that exact text, not
 * invented copy. `suggestedSkills` therefore names tags real seeded providers
 * carry, which is what makes the reading matchable.
 */
const DIAGNOSTICS: SeedDiagnostic[] = [
  {
    userKey: 'floor_installer_br',
    daysAgo: 12,
    situation:
      "Sou instalador de pisos e este ano peguei obra que não parava, mas no fim do mês não sobra nada. Eu não sei quanto custa cada obra de verdade: junto material, ajudante e deslocamento tudo na mesma planilha e chuto o preço em cima do que o concorrente cobra. Como recebo parcelado e pago o material à vista, três vezes precisei antecipar recebível no banco pra fechar a folha. E o orçamento eu ainda faço na mão, de noite, depois da obra.",
    scores: { vendas: 54, gestao: 70, tecnologia: 50, financas: 33 },
    weakestPillar: GrowthPillar.FINANCAS,
    summary:
      "Finanças é o pilar mais frágil da sua operação hoje: 33/100, contra 70/100 em Gestão. O que puxou esse número foi o que você mesmo escreveu — “Eu não sei quanto custa cada obra de verdade: junto material, ajudante e deslocamento tudo na mesma planilha e chuto o preço em cima do que o concorrente cobra”. Sem saber o custo real de cada entrega, todo preço é chute: dá para estar vendendo muito bem exatamente aquilo que dá prejuízo, e recusando o que dava margem.\n\nSome a isso caixa sem projeção, que aparece quando você diz “Sou instalador de pisos e este ano peguei obra que não parava, mas no fim do mês não sobra nada”. Caixa que só aparece quando já apertou é problema de projeção, não de faturamento — o mesmo aperto é visível com seis semanas de antecedência numa projeção rolante. Os dois juntos explicam por que Finanças ficou abaixo dos outros pilares: não é um problema isolado, é um padrão que se repete na semana.\n\nTecnologia vem logo atrás (50/100), puxada por trabalho manual repetitivo e planilha usada como sistema — trate depois de estabilizar Finanças, ou você divide a atenção entre duas frentes e não resolve nenhuma.\n\nGestão não apareceu no seu relato e ficou na linha de base (70/100). Isso quer dizer \"sem evidência\", não \"está resolvido\" — este diagnóstico só pontua o que você descreveu.\n\nO primeiro passo é objetivo: levantar o custo real por serviço (mão de obra + insumo + rateio de estrutura) antes de mexer em qualquer preço.",
    recommendations: [
      "Levantar o custo real por serviço (mão de obra + insumo + rateio de estrutura) antes de mexer em qualquer preço.",
      "Montar a projeção de caixa rolante de 13 semanas e reatualizá-la toda segunda-feira.",
      "Medir o ciclo de caixa em dias e renegociar prazo com os três maiores fornecedores antes de tomar mais crédito.",
      "Automatizar emissão e conciliação da cobrança, com uma tela única de \"faturado x recebido\" fechando todo dia.",
    ],
    suggestedSkills: ["CONTROLLER", "FINANCIAL_AUDIT", "PAYMENTS", "STRIPE_WEBHOOK", "AI_AUTOMATION"],
  },
  {
    userKey: 'growth_client_us',
    daysAgo: 4,
    situation:
      "Minha agência em Austin trabalha com times brasileiros e o problema não é entrega, é venda. Entra bastante lead pelo site e pelas indicações dos clientes antigos, mas eu não consigo fechar: mando a proposta e o cliente some, aí eu dou desconto pra tentar salvar e mesmo assim some. Não tenho funil nenhum, o acompanhamento vive espalhado entre WhatsApp e e-mail, e não sei dizer quantas propostas mandei mês passado.",
    scores: { vendas: 35, gestao: 70, tecnologia: 53, financas: 70 },
    weakestPillar: GrowthPillar.VENDAS,
    summary:
      "Vendas é o pilar mais frágil da sua operação hoje: 35/100, contra 70/100 em Gestão. O que puxou esse número foi o que você mesmo escreveu — “Entra bastante lead pelo site e pelas indicações dos clientes antigos, mas eu não consigo fechar: mando a proposta e o cliente some, aí eu dou desconto pra tentar salvar e mesmo assim some”. Quando o contato chega e não fecha, o furo está entre a conversa e a proposta: falta ancorar o resultado antes de mostrar o preço, e falta um retorno com data marcada na frente do cliente.\n\nSome a isso funil sem visibilidade, que aparece quando você diz “Não tenho funil nenhum, o acompanhamento vive espalhado entre WhatsApp e e-mail, e não sei dizer quantas propostas mandei mês passado”. Sem registro de etapa e de próximo passo, \"como estão as vendas\" é opinião, não número — e o contato que sumiu no meio nunca é percebido. Os dois juntos explicam por que Vendas ficou abaixo dos outros pilares: não é um problema isolado, é um padrão que se repete na semana.\n\nTecnologia vem logo atrás (53/100), puxada por operação inteira no WhatsApp e presença digital fraca — trate depois de estabilizar Vendas, ou você divide a atenção entre duas frentes e não resolve nenhuma.\n\nGestão e Finanças não apareceram no seu relato e ficaram na linha de base (70/100). Isso quer dizer \"sem evidência\", não \"está resolvido\" — este diagnóstico só pontua o que você descreveu.\n\nO primeiro passo é objetivo: padronizar a proposta em uma página (problema, escopo, resultado esperado, preço) e marcar o follow-up com o cliente ainda na reunião.",
    recommendations: [
      "Padronizar a proposta em uma página (problema, escopo, resultado esperado, preço) e marcar o follow-up com o cliente ainda na reunião.",
      "Definir três perguntas de qualificação no primeiro contato e recusar rápido quem não passa — isso devolve tempo comercial para quem fecha.",
      "Trocar desconto por escopo: ofereça uma versão menor por um preço menor, nunca o mesmo escopo mais barato.",
      "Criar um modelo de orçamento com faixas de escopo já precificadas, para responder no mesmo dia sem recalcular do zero.",
    ],
    suggestedSkills: ["B2B_NETWORKING", "STARTUPS", "LOCAL_SEO", "AI_AUTOMATION", "SaaS"],
  },
];

/** Score rows for the seeded providers — the K-SCORE the mentors directory ranks on. */
const PROVIDER_SCORES: Array<{ creatorKey: string; kScore: number; completedJobs: number }> = [
  { creatorKey: 'ai_dev_br', kScore: 862, completedJobs: 41 },
  { creatorKey: 'uiux_designer_br', kScore: 780, completedJobs: 28 },
  { creatorKey: 'video_editor_br', kScore: 705, completedJobs: 33 },
  { creatorKey: 'floor_installer_br', kScore: 640, completedJobs: 57 },
  { creatorKey: 'plumber_br', kScore: 590, completedJobs: 62 },
];

/**
 * Launch content for the "Conteúdo" hub. These are the articles real users
 * will read on day one, so they are written as real editorial pieces rather
 * than filler. `coverImageUrl` stays null on purpose — the client renders a
 * generated gradient, which is better than a hotlinked image that 404s.
 */
const ARTICLES: SeedArticle[] = [
  {
    authorKey: 'ai_dev_br',
    category: ArticleCategory.TECNOLOGIA,
    daysAgo: 2,
    viewCount: 412,
    title: 'Automação que sobrevive ao primeiro mês: como escolher o processo certo',
    excerpt:
      'A maior parte das automações morre em oito semanas, e quase nunca por problema técnico. Morre porque foi aplicada ao processo errado, por uma única pessoa, sem métrica combinada antes de começar. Este é o critério de escolha que usamos em mais de quarenta implantações.',
    body: `Toda empresa que automatiza algo pela primeira vez comete o mesmo erro: começa pelo processo mais visível, não pelo mais caro. O resultado aparece rápido em demonstração e some em dois meses, quando a pessoa que montou o fluxo sai de férias e ninguém sabe por onde ele passa.

Depois de mais de quarenta implantações em empresas de 10 a 200 pessoas, o padrão do que sobrevive é bastante previsível. Ele tem menos a ver com a ferramenta escolhida e mais com o critério de escolha do processo.

## O critério: hora cara, alta repetição, regra estável

Um processo é bom candidato quando as três condições aparecem juntas:

1. **Consome hora de gente qualificada.** Automatizar dez minutos do estagiário economiza dez minutos do estagiário. Automatizar duas horas semanais do time comercial devolve receita.
2. **Repete com frequência alta.** Uma tarefa mensal quase nunca paga o custo de manutenção da automação. Diária ou semanal, sim.
3. **Tem regra estável.** Se o critério de decisão muda a cada cliente, você não tem um processo, tem um julgamento — e julgamento não se automatiza, se apoia.

Falhando qualquer uma das três, a automação vira dívida técnica com cara de inovação.

## O piloto de 30 dias

Escolha **um** processo, **um** time e **trinta dias**. Antes de mexer em qualquer ferramenta, meça o estado atual: quantas horas por semana a tarefa consome hoje e quantos erros ela gera. Sem essa linha de base, ao final do piloto ninguém consegue afirmar se valeu a pena, e a decisão vira opinião.

Durante o piloto, resista a ampliar o escopo. O pedido "já que estamos mexendo, aproveita e faz também" é o que transforma um teste de trinta dias em um projeto de seis meses.

## Integração antes de contrato

Verifique se a ferramenta conversa com o sistema que a empresa já usa **antes** de assinar. Automação que não escreve de volta no ERP ou no CRM cria digitação dupla, e digitação dupla é abandonada em semanas — com o agravante de que agora existem duas versões da verdade.

## Checklist de execução

- [ ] Levantar onde o time gasta mais horas repetitivas por semana
- [ ] Escolher um processo que atenda aos três critérios acima
- [ ] Medir a linha de base: horas gastas e taxa de erro atual
- [ ] Confirmar integração com os sistemas existentes
- [ ] Rodar 30 dias sem ampliar o escopo
- [ ] Documentar o passo a passo operacional em texto simples
- [ ] Treinar um segundo responsável antes de expandir

## O item que quase todo mundo pula

O último. Se apenas uma pessoa sabe operar e consertar a automação, você não removeu um gargalo — apenas mudou o nome dele. Documentar e treinar um segundo responsável custa meio dia e é a diferença entre uma automação que dura três anos e uma que dura até as próximas férias.

## O que medir

Horas recuperadas por semana, taxa de adoção do time e custo por processo automatizado. Três números, revisados mensalmente. Se as horas recuperadas não aparecem até o fim do piloto, o problema não é a ferramenta: é o processo escolhido.`,
  },
  {
    authorKey: 'ai_dev_br',
    category: ArticleCategory.GESTAO,
    daysAgo: 9,
    viewCount: 296,
    title: 'O gargalo não fica onde a equipe reclama',
    excerpt:
      'Em toda operação existe um único recurso que limita a vazão de todos os outros. Ele quase nunca é o mesmo que aparece nas reclamações da equipe. Este artigo mostra como encontrá-lo com um cronômetro e uma planilha, e o que fazer depois.',
    body: `Pergunte a qualquer equipe onde está o gargalo da operação e você vai receber uma resposta rápida, confiante e quase sempre errada. As pessoas apontam onde o trabalho é mais desagradável, não onde ele espera mais. São coisas diferentes, e só a segunda determina quanto a empresa consegue entregar por mês.

## Por que a percepção engana

Quem executa sente o esforço da própria etapa. Ninguém sente a fila que se formou antes dela. Só que a capacidade de uma operação é definida pela etapa mais lenta da cadeia — todas as outras podem melhorar 30% sem que a entrega final se mova um dia.

Três sinais de que o gargalo está mal identificado:

- Investimentos de melhoria não mudam o prazo final de entrega
- Uma área vive sobrecarregada enquanto outra tem folga na mesma semana
- Ninguém consegue dizer, sem abrir uma planilha, quanto tempo leva uma entrega ponta a ponta

## Como achar de verdade

1. **Escolha um processo e siga três execuções reais.** Não três casos típicos imaginados em reunião: três de verdade, com data e hora.
2. **Cronometre tempo de trabalho e tempo de fila separadamente.** Tempo de trabalho é quando alguém está mexendo naquilo. Tempo de fila é quando aquilo está parado esperando. Em quase toda operação de serviço, a fila é 80% do prazo.
3. **Some as filas por etapa.** O gargalo é onde o trabalho espera mais. Simples assim.
4. **Não mexa em mais nada.** Melhorar uma etapa que não é gargalo só produz estoque parado na frente dele.

## O que fazer com o gargalo

Na ordem, e só passe para a próxima quando a anterior estiver esgotada: **proteja** (garanta que ele nunca fique ocioso por falta de insumo), **simplifique** (tire dele tudo que outra etapa poderia fazer), **reforce** (aumente capacidade — contrate, compre, terceirize).

A ordem importa porque as duas primeiras são de graça e a terceira custa. Quase toda empresa começa pela terceira.

## Checklist de execução

- [ ] Escolher UM processo crítico para atacar neste mês
- [ ] Cronometrar três execuções reais, ponta a ponta
- [ ] Separar tempo de trabalho de tempo de fila em cada etapa
- [ ] Identificar o gargalo pela maior fila acumulada
- [ ] Proteger o gargalo contra ociosidade
- [ ] Retirar do gargalo toda tarefa que outra etapa pode absorver
- [ ] Só então avaliar aumento de capacidade

## O ritmo que sustenta

Um gargalo resolvido move a restrição para outro lugar — isso é sinal de sucesso, não de fracasso. Por isso o exercício não é um projeto, é um ciclo. Uma reunião semanal de trinta minutos, com lead time, retrabalho e custo por entrega na tela, basta para manter o ciclo girando.

E vale o aviso final: não compre sistema novo antes do processo estar estável. A ferramenta não organiza o caos, ela só o registra mais rápido.`,
  },
  {
    authorKey: 'growth_client_us',
    category: ArticleCategory.VENDAS,
    daysAgo: 5,
    viewCount: 531,
    title: 'Previsibilidade comercial: por que o seu mês ainda depende do fundador',
    excerpt:
      'Quando o resultado do mês oscila conforme a agenda de uma pessoa, o problema não é falta de esforço comercial — é ausência de processo. Um funil previsível se constrói com quatro decisões, e nenhuma delas envolve contratar mais vendedores.',
    body: `Existe um momento na vida de toda empresa de serviços em que o fundador percebe que virou o gargalo comercial. Os meses bons são os meses em que ele conseguiu fazer reuniões; os ruins são aqueles em que a entrega comeu a agenda. O faturamento vira uma função da disponibilidade de uma pessoa.

A saída não é contratar vendedor. Contratar vendedor sem processo apenas distribui a imprevisibilidade entre mais gente.

## Os quatro passos do funil de previsibilidade

1. **Defina o cliente que você quer repetir.** Liste os dez melhores contratos dos últimos doze meses — melhores por margem e por facilidade de entrega, não por tamanho. Procure o padrão: porte, setor, gatilho de compra. É esse recorte que define a prospecção, e não "todo mundo que precisa do que vendemos".
2. **Separe geração de demanda de fechamento.** São habilidades diferentes e, mais importante, são agendas diferentes. Quando a mesma pessoa faz as duas coisas, o fechamento sempre ganha — é mais urgente — e o mês seguinte fica vazio.
3. **Documente a conversa que fecha.** Grave e transcreva as reuniões que viraram contrato. As mesmas cinco perguntas aparecem em quase todas. Transforme-as em roteiro para que o resultado deixe de depender de talento individual.
4. **Feche o ciclo no pós-venda.** Em serviço, o melhor canal de aquisição é o cliente satisfeito — e ele quase nunca indica por conta própria, porque ninguém pediu. Coloque o pedido de indicação como etapa formal, com data e responsável.

## O erro de sequência mais caro

Aumentar volume de prospecção antes de corrigir a taxa de conversão. Se de cada dez reuniões você fecha uma, dobrar as reuniões apenas dobra o número de pessoas para quem você vai perder — e queima lista que levaria meses para reconstruir. Conserte a conversão primeiro; ela é mais barata de melhorar do que a geração.

## Checklist de execução

- [ ] Listar os dez melhores contratos do último ano e extrair o padrão
- [ ] Escrever em uma frase o problema que você resolve melhor que qualquer um
- [ ] Bloquear na agenda horários fixos de prospecção que não podem ser remarcados
- [ ] Padronizar a proposta comercial com escopo e preço claros
- [ ] Registrar o motivo real de cada perda, em texto livre, no CRM
- [ ] Revisar semanalmente a conversão por etapa do funil
- [ ] Tornar o pedido de indicação uma etapa obrigatória do pós-venda

## O que medir

Três números: conversão por etapa, ciclo de venda em dias e ticket médio. Revisados toda semana, na mesma tela, com a equipe presente.

O sinal de que funcionou não é o mês recorde. É o mês em que o fundador esteve fora e o resultado não caiu.`,
  },
  {
    authorKey: 'video_editor_br',
    category: ArticleCategory.MARKETING,
    daysAgo: 12,
    viewCount: 674,
    title: 'Os três primeiros segundos: o que a retenção em vídeo ensina sobre qualquer comunicação',
    excerpt:
      'A regra que dobrou a retenção de clientes americanos em vídeo curto não é sobre corte rápido nem sobre legenda animada. É sobre entregar a razão de continuar antes de pedir a atenção — e isso vale para proposta comercial, e-mail e página de vendas.',
    body: `Quando comecei a editar para marcas nos Estados Unidos, a métrica que todo mundo olhava era o tempo médio assistido. Errado. O número que decide o destino de um vídeo curto é a retenção nos três primeiros segundos: se metade da audiência sai ali, nada do que vem depois importa, por melhor que seja.

O mesmo vale para uma proposta comercial que ninguém lê até a página três, ou para um e-mail excelente cujo assunto não abriu.

## A regra: mostre a razão antes de pedir a atenção

O erro clássico é abrir com contexto — apresentação, agradecimento, "hoje eu vou falar sobre". Contexto é o que você precisa dizer; razão é o que a pessoa precisa ouvir para ficar. A abertura tem que conter o problema reconhecível ou o resultado inesperado, na primeira frase.

Três aberturas que funcionam de forma consistente:

- **O problema nomeado**: "Se o seu anúncio converte e mesmo assim você perde dinheiro, o problema não está no anúncio."
- **O resultado com número**: "Cortamos 40% do custo por lead sem trocar de plataforma. Foi uma mudança de duas linhas."
- **A contradição**: "Postar mais reduziu o alcance dessa conta. Explico o porquê."

## Ativo, não campanha

Campanha para quando o orçamento acaba; ativo continua trabalhando. Um vídeo de referência sobre um problema específico, uma calculadora, um diagnóstico — esses continuam gerando conversa meses depois de publicados. Antes de investir em mais volume, garanta que existe pelo menos um ativo com profundidade real sobre o tema que você quer dominar.

## Feche o caminho até a conversa

A maior perda em marketing de serviço não está no topo do funil, está no meio: alguém interessado que não sabe qual é o próximo passo. Uma única chamada para ação óbvia por peça. Duas opções já dividem a atenção; três anulam.

## Checklist de execução

- [ ] Escrever a dor central em uma frase que o próprio cliente usaria
- [ ] Reescrever a abertura de cada peça para conter razão, não contexto
- [ ] Escolher um único canal para dominar nos próximos 90 dias
- [ ] Produzir um ativo de referência com profundidade real
- [ ] Deixar uma única chamada para ação clara em cada peça
- [ ] Registrar a origem de toda oportunidade que entra
- [ ] Cortar o canal que não gerou conversa qualificada em dois ciclos

## O que medir

Conversas qualificadas, custo por conversa qualificada e receita por origem. Alcance e curtida não pagam folha — servem, no máximo, como indicador antecedente.

E resista à troca de canal a cada dois meses. Nenhum canal mostra o que consegue fazer antes de um ciclo completo de amadurecimento, e a impaciência é responsável por mais fracasso de marketing do que a falta de orçamento.`,
  },
  {
    authorKey: 'uiux_designer_br',
    category: ArticleCategory.ESTRATEGIA,
    daysAgo: 16,
    viewCount: 358,
    title: 'Estratégia é escolher o que não fazer',
    excerpt:
      'Um plano anual com doze prioridades não é uma estratégia — é uma lista de desejos com data. Este artigo apresenta o método que usamos para cortar prioridades até sobrarem três, e como testar a aposta central antes de reorganizar a empresa em torno dela.',
    body: `Todo plano anual que já vi começar com doze prioridades terminou o ano com doze itens pela metade. Não por incompetência de execução: por aritmética. Uma empresa pequena tem uma quantidade fixa de atenção da liderança, e atenção dividida por doze não move nada.

Estratégia, na prática, é a lista do que a empresa decidiu **não** fazer neste ano. Se essa lista não existe por escrito, não há estratégia — há intenção.

## O método: quatro passos

1. **Escreva a escolha, não o desejo.** "Crescer 40%" é desejo. "Crescer 40% dentro do segmento X, abrindo mão de atender Y" é escolha. A diferença é que a segunda pode estar errada — e só o que pode estar errado pode ser testado.
2. **Ancore na vantagem que você já tem.** Vantagem competitiva raramente é inventada em workshop; ela é reconhecida. Ligue para dez clientes atuais e pergunte por que escolheram vocês e por que ficaram. As respostas costumam ser desconfortavelmente diferentes do que está no site.
3. **Teste com o menor experimento possível.** Antes de reorganizar time e orçamento em torno da aposta, encontre o teste mais barato capaz de invalidá-la. Defina de antemão qual resultado faria vocês desistirem. Se nenhum resultado faria, não é uma aposta, é uma crença.
4. **Traduza em três iniciativas com dono, métrica e data.** No máximo três por trimestre. Uma tese sem iniciativa é slide.

## O teste das duas frases

Peça a cinco pessoas do time que expliquem a estratégia da empresa em duas frases, separadamente. Se as cinco respostas divergirem, o problema não é comunicação interna: é que a estratégia ainda não foi decidida, apenas discutida.

## Checklist de execução

- [ ] Escrever a estratégia em duas frases e testar com cinco pessoas do time
- [ ] Listar explicitamente o que a empresa NÃO vai fazer neste ano
- [ ] Entrevistar dez clientes sobre por que escolheram e por que ficaram
- [ ] Definir a aposta central e a evidência que a invalidaria
- [ ] Desenhar o menor experimento capaz de gerar essa evidência
- [ ] Escolher no máximo três iniciativas trimestrais, com dono e métrica
- [ ] Agendar a revisão de meio de trimestre antes do trimestre começar

## O que medir

Concentração de receita no segmento escolhido, iniciativas efetivamente concluídas e margem de contribuição por linha de negócio. O terceiro costuma ser o mais revelador: é comum descobrir que a linha de maior faturamento é a de menor margem, e que ela consome justamente a atenção que a aposta precisaria.

Uma última confusão que custa caro: orçamento não é estratégia. A planilha organiza recursos; ela não decide onde você vai vencer. Fazer o orçamento primeiro e chamar de plano é a forma mais comum de terminar o ano ocupado e parado no mesmo lugar.`,
  },
  {
    authorKey: 'floor_installer_br',
    category: ArticleCategory.FINANCAS,
    daysAgo: 20,
    viewCount: 289,
    title: 'Lucro no papel, caixa no vermelho: o fluxo de 13 semanas explicado',
    excerpt:
      'Dar lucro e ter dinheiro em conta são coisas diferentes — e é a segunda que quebra empresa. O fluxo de caixa de 13 semanas é a ferramenta mais barata para enxergar o problema com antecedência suficiente para reagir.',
    body: `Passei três anos fechando meses no positivo e mesmo assim adiando pagamento de fornecedor. Demorei a entender uma coisa simples: lucro é competência do período, caixa é quando o dinheiro efetivamente entra e sai. Empresa não quebra por prejuízo; quebra por não ter dinheiro no dia em que a conta vence.

## Por que 13 semanas

Projeção anual é ficção — ninguém sabe o que vai vender em outubro. Projeção mensal é curta demais para dar tempo de reagir. Treze semanas, cerca de um trimestre, é o ponto em que a projeção ainda é confiável e o horizonte ainda permite negociar prazo, adiar compra ou antecipar recebível antes do aperto.

A construção é direta: uma coluna por semana, entradas previstas em cima, saídas previstas embaixo, saldo acumulado na última linha. Sem sofisticação. O valor está na disciplina de atualizar toda segunda-feira com número real, não estimado.

## Os quatro passos

1. **Separe lucro de caixa.** Faça o exercício de olhar o mesmo mês pelas duas óticas. A diferença entre os dois números é exatamente o seu problema de prazo.
2. **Monte o fluxo de 13 semanas.** Comece com o saldo real de hoje, não com o saldo desejado.
3. **Ataque o ciclo financeiro.** Some prazo médio de recebimento e de estoque, subtraia prazo médio de pagamento. Cada dia cortado desse ciclo devolve dinheiro ao caixa sem custo de banco. Negociar 15 dias a mais com os três maiores fornecedores costuma valer mais que qualquer linha de crédito.
4. **Defina a reserva mínima operacional.** Quantas semanas de custo fixo a empresa mantém em caixa? Escreva o número, trate como cláusula e não como meta. Abaixo dele, decisões de investimento ficam automaticamente suspensas.

## Checklist de execução

- [ ] Separar contas de pessoa física, pessoa jurídica e reserva
- [ ] Montar o fluxo de caixa das próximas 13 semanas
- [ ] Levantar prazo médio de recebimento e de pagamento
- [ ] Calcular a margem de contribuição por serviço prestado
- [ ] Definir a reserva mínima em semanas de custo fixo
- [ ] Atualizar o fluxo toda segunda-feira com número real
- [ ] Renegociar prazo com os três maiores fornecedores

## O que medir

Ciclo financeiro em dias, reserva de caixa em semanas de custo fixo e margem de contribuição por linha de serviço. Três números que cabem em meia página.

## O sinal de alerta que quase ninguém lê

Descontar recebível de forma recorrente para fechar a folha. Feito uma vez, é gestão de fluxo; feito todo mês, é um financiamento caro disfarçado de normalidade. Quando esse padrão aparece, o problema quase nunca é volume de vendas — é margem ou prazo, e crescer vendendo mais apenas acelera a conta.`,
  },
  {
    authorKey: 'plumber_br',
    category: ArticleCategory.LIDERANCA,
    daysAgo: 24,
    viewCount: 245,
    title: 'De melhor técnico a líder de equipe: o que muda quando você para de executar',
    excerpt:
      'A promoção que mais destrói bons profissionais é a de especialista para líder, porque as duas funções premiam comportamentos opostos. Este é o contrato de liderança que uso com cada pessoa da minha equipe, escrito em uma página.',
    body: `Fui promovido pelo motivo errado: eu era o que mais entregava. Ninguém me avisou que a habilidade que me colocou ali era exatamente a que eu precisaria parar de usar. Passei o primeiro ano tentando ser o melhor técnico e o líder ao mesmo tempo, e fui medíocre nas duas coisas.

O que virou a chave foi tornar explícito o que sempre esteve implícito.

## O contrato de liderança, em quatro partes

1. **Torne o combinado explícito.** A maior parte dos conflitos de equipe nasce de expectativa não dita. Escreva com cada pessoa o que significa um bom trimestre para a função dela — em resultado, não em esforço. "Se dedicar mais" não é combinado; "fechar as ordens de serviço no mesmo dia, com foto do antes e depois" é.
2. **Dê feedback no ciclo curto.** Feedback guardado para a avaliação semestral chega tarde demais para mudar qualquer coisa e cedo demais para ser esquecido. Fale em até 48 horas, sobre o comportamento observável e o efeito que ele causou. Sem adjetivo sobre a pessoa.
3. **Delegue a decisão, não só a tarefa.** Delegar tarefa mantém você no centro: todo mundo executa e volta para perguntar. Delegue a decisão, defina o limite de risco aceitável — "até tal valor, você resolve" — e combine em que ponto a pessoa deve te procurar.
4. **Proteja o tempo de pensar.** Um líder com a agenda 100% ocupada não está liderando, está reagindo. Duas horas semanais bloqueadas para planejamento, tratadas como compromisso com cliente.

## Os sinais de que o contrato não existe

- Todo mundo pede aprovação para decisões de baixo impacto
- Os problemas só aparecem quando já viraram crise
- As pessoas boas saem sem que você tenha visto vindo

Os três significam a mesma coisa: as pessoas não sabem o que podem decidir sozinhas nem o que se espera delas.

## Checklist de execução

- [ ] Escrever o que é um bom trimestre para cada posição da equipe
- [ ] Agendar uma conversa individual quinzenal de 30 minutos
- [ ] Dar um feedback específico em até 48 horas do fato observado
- [ ] Listar as decisões que você ainda toma e poderia delegar
- [ ] Definir o limite de risco em que a pessoa deve te consultar
- [ ] Bloquear duas horas semanais de planejamento na agenda
- [ ] Perguntar em cada individual o que está atrapalhando a entrega

## O que medir

Rotatividade voluntária, número de decisões escaladas que poderiam ter parado antes e percentual de compromissos cumpridos na data acordada.

E o aviso que eu gostaria de ter recebido: ser querido não substitui deixar claro o que se espera. Proximidade sem clareza gera equipe confortável e resultado ruim — e, quando o resultado aperta, a conta chega junto com a sensação de traição de parte a parte.`,
  },
  {
    authorKey: 'uiux_designer_br',
    category: ArticleCategory.CARREIRA,
    daysAgo: 27,
    viewCount: 503,
    title: 'Portfólio que fecha contrato: transforme entrega em evidência',
    excerpt:
      'Bom trabalho não fala por si — ele fala apenas para quem estava olhando. A diferença entre o profissional lembrado e o esquecido raramente está na qualidade da entrega, e quase sempre em ter transformado essa entrega em evidência verificável.',
    body: `Existe uma categoria de profissional que entrega muito e é lembrada pouco. Não é falta de competência nem excesso de modéstia: é ausência de registro. Resultado que ninguém consegue verificar não vira oportunidade, porque quem decide contratar não estava lá para ver.

## Os quatro passos do capital profissional

1. **Escolha o problema que você quer ser chamado para resolver.** Reputação não se constrói em torno de um cargo, e sim de um problema. "Designer de produto" é cargo. "Redesenho painéis de SaaS que perdem usuário na primeira semana" é problema — e é isso que faz alguém lembrar de você quando o problema aparece.
2. **Transforme entrega em evidência.** Registre número, contexto e o antes e depois enquanto ainda está fresco. Seis meses depois você não lembra qual era a taxa de ativação antes, e sem esse número o caso vira anedota.
3. **Construa rede antes de precisar.** A rede que funciona é a cultivada quando você não estava pedindo nada. Ajude cinco pessoas por mês de forma concreta — uma indicação, uma revisão de portfólio, uma apresentação — sem contrapartida.
4. **Renegocie com dados.** Chegue à conversa de promoção ou de preço com evidência de impacto e referência de mercado. "Estou há muito tempo aqui" não move ninguém; "estes três projetos geraram este resultado, e a faixa de mercado para isso é esta" move.

## O formato de caso que funciona

Quatro blocos curtos, meia página no total: **contexto** (qual era a situação e a restrição), **decisão** (o que você escolheu fazer e o que descartou), **resultado** (número antes, número depois, prazo), **aprendizado** (o que faria diferente). O bloco da decisão é o que separa o profissional do executor — mostra critério, não só execução.

## Checklist de execução

- [ ] Escrever em uma frase o problema que você resolve melhor
- [ ] Listar as cinco entregas mais relevantes dos últimos dois anos
- [ ] Recuperar os números de antes e depois de cada uma
- [ ] Reescrever cada caso no formato de quatro blocos
- [ ] Atualizar o material público com essas evidências
- [ ] Escolher cinco pessoas por mês para ajudar sem pedir nada
- [ ] Marcar a conversa de renegociação com data e pauta escritas

## O que medir

Convites recebidos sem que você tenha procurado, número de entregas documentadas com resultado mensurável e quantidade de conversas relevantes fora da sua empresa no trimestre.

## A armadilha do especialista

Quanto melhor tecnicamente alguém é, mais tende a acreditar que a qualidade se anuncia sozinha. Ela não se anuncia — ela se acumula em silêncio, e no dia em que a oportunidade aparece, quem decide escolhe entre as evidências que conseguiu ver. Documentar o próprio trabalho não é autopromoção: é a parte da entrega que a maioria simplesmente não faz.`,
  },
];

/**
 * Comunidades ("Círculos") — the paid peer groups. All three are hosted by
 * the mentors above. `minKScore` climbs with the tier, so the entry Círculo is
 * open to anyone and the Conselho is genuinely earned.
 */
const COMMUNITIES: SeedCommunity[] = [
  {
    key: 'circulo_origem',
    hostKey: 'video_editor_br',
    tier: CommunityTier.CIRCULO,
    name: 'Círculo Origem',
    tagline: 'Um grupo pequeno que evolui junto — e cobra o combinado.',
    description:
      'Doze fundadores em estágio parecido, uma Mesa Redonda por mês e uma regra simples: cada membro chega com um problema real e sai com um plano de trinta dias. Entre os encontros, o grupo funciona como banca — quem pergunta também responde. Compromisso mínimo de um ano, porque confiança de grupo não se constrói em trimestre.',
    monthlyFee: 490,
    seatLimit: 12,
    cadence: 'Mesa Redonda mensal ao vivo (2h) + banca contínua entre os encontros',
    minKScore: 0,
    focusTopics: ['Primeiro milhão', 'Processos', 'Time enxuto', 'Precificação'],
  },
  {
    key: 'orbita_scale',
    hostKey: 'uiux_designer_br',
    tier: CommunityTier.SCALE,
    name: 'Órbita Scale',
    tagline: 'Conexão, suporte e uma sala de negócios onde o combinado vira contrato.',
    description:
      'Oito empresas já operando com time montado, um mentor anfitrião dedicado e uma sala de negócios permanente: membros publicam briefings reais e contratam uns aos outros dentro do grupo, com escrow da plataforma cobrindo a entrega. O encontro é quinzenal e a pauta é sempre o gargalo da vez de um dos membros. Compromisso mínimo de um ano.',
    monthlyFee: 1290,
    seatLimit: 8,
    cadence: 'Encontro quinzenal com mentor anfitrião + sala de negócios permanente',
    minKScore: 550,
    focusTopics: ['Escala de operação', 'Aquisição previsível', 'Parcerias', 'Contratação de líderes'],
  },
  {
    key: 'conselho_socios',
    hostKey: 'ai_dev_br',
    tier: CommunityTier.CONSELHO,
    name: 'Conselho de Sócios',
    tagline: 'Um conselho consultivo trimestral para a sua empresa, não para a sua agenda.',
    description:
      'Seis cadeiras, reunião trimestral com pauta formal e ata: cada trimestre um membro leva os próprios números e recebe do grupo uma recomendação escrita, com responsável e prazo. É o formato mais exigente da plataforma — entra quem já tem histórico e sai quem não contribui. Compromisso mínimo de um ano.',
    monthlyFee: 2900,
    seatLimit: 6,
    cadence: 'Reunião de conselho trimestral (4h) com pauta, ata e recomendação escrita',
    minKScore: 720,
    focusTopics: ['Governança', 'Sucessão', 'Estratégia de longo prazo', 'Captação'],
  },
];

/**
 * Active seats. `contributionScore` is derived from the reciprocity counters
 * (see deriveContributionScore) rather than typed by hand, so the number in
 * the member list always matches the asked/answered pair next to it.
 */
const MEMBERSHIPS: SeedMembership[] = [
  { communityKey: 'circulo_origem', memberKey: 'floor_installer_br', askedCount: 6, answeredCount: 14 },
  { communityKey: 'circulo_origem', memberKey: 'plumber_br', askedCount: 9, answeredCount: 7 },
  { communityKey: 'circulo_origem', memberKey: 'growth_client_us', askedCount: 4, answeredCount: 11 },
  { communityKey: 'orbita_scale', memberKey: 'ai_dev_br', askedCount: 3, answeredCount: 19 },
  { communityKey: 'orbita_scale', memberKey: 'floor_installer_br', askedCount: 8, answeredCount: 2 },
  { communityKey: 'conselho_socios', memberKey: 'uiux_designer_br', askedCount: 5, answeredCount: 12 },
];

/** A seat is kept by both asking and answering — answering simply counts for more. */
function deriveContributionScore(askedCount: number, answeredCount: number): number {
  return askedCount + answeredCount * 3;
}

/** Lowercase, accent-stripped, hyphenated — same rule ContentService applies to user-submitted titles. */
function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** 200 words/minute, floor of 1 — same estimate ContentService uses. */
function estimateReadMinutes(body: string): number {
  return Math.max(1, Math.round(body.trim().split(/\s+/).filter(Boolean).length / 200));
}

const POSTS: SeedPost[] = [
  {
    creatorKey: 'ai_dev_br',
    daysAgo: 6,
    title: 'How I built an AI Voice Agent for a Miami Clinic in 24 hours',
    contentText:
      'Walkthrough of the exact Make.com scenario + Vapi voice agent I shipped for a Miami dermatology clinic: appointment booking, no-show follow-ups, and FAQ handling — fully hands-off after setup.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day1-ai-voice-agent.mp4',
    videoDurationSeconds: 58,
    likesCount: 230,
    viewsCount: 1200,
    tags: ['AI_AUTOMATION', 'MAKE', 'CLOUD'],
  },
  {
    creatorKey: 'floor_installer_br',
    daysAgo: 5,
    title: 'Antes e Depois: Restauração completa de piso vinílico em apartamento padrão',
    contentText:
      'Carrossel mostrando a técnica de colagem rápida usada na restauração completa de um piso vinílico residencial — do contrapiso ao acabamento final em um único dia de trabalho.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day2-piso-vinilico-carrossel.jpg',
    likesCount: 89,
    viewsCount: 450,
    tags: ['FLOOR_INSTALLATION', 'LOCAL_SERVICE', 'MAINTENANCE'],
  },
  {
    creatorKey: 'video_editor_br',
    daysAgo: 4,
    title: "The 3-second hook rule that doubled my US client's retention on TikTok",
    contentText:
      'Breaking down the fast-cut, dynamic-caption edit style I applied for a US skincare brand — retention went from 41% to 83% on the first 3 seconds alone.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day3-hook-rule.mp4',
    videoDurationSeconds: 34,
    likesCount: 410,
    viewsCount: 2100,
    tags: ['VIDEO_EDITING', 'SHORT_FORM', 'CLOUD'],
  },
  {
    creatorKey: 'growth_client_us',
    daysAgo: 3,
    title: 'Buscando parceiro técnico no Brasil para escala de agência de Growth em Austin/TX',
    contentText:
      'Agência de growth em Austin/TX buscando um parceiro técnico brasileiro para joint venture — foco em automação, dashboards e entrega white-label para clientes americanos. Aberto a modelos de sociedade.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day4-b2b-partnership.jpg',
    likesCount: 120,
    viewsCount: 800,
    tags: ['B2B_NETWORKING', 'STARTUPS'],
  },
  {
    creatorKey: 'uiux_designer_br',
    daysAgo: 2,
    title: 'Redesigning a SaaS Dashboard for high conversion without losing speed',
    contentText:
      'Figma walkthrough of a full SaaS dashboard redesign — cut cognitive load by 40% while keeping every interaction under 100ms perceived latency.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day5-saas-dashboard-figma.jpg',
    likesCount: 156,
    viewsCount: 640,
    tags: ['UI_UX', 'DESIGN', 'CLOUD'],
  },
  {
    creatorKey: 'plumber_br',
    daysAgo: 1,
    title: 'Como trocar o refil do filtro de água em 5 minutos sem quebrar a tubulação',
    contentText:
      'Tutorial rápido mostrando o passo a passo seguro para trocar o refil do filtro de água da torneira, sem precisar de ferramentas especiais.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day6-filtro-agua-tutorial.mp4',
    videoDurationSeconds: 45,
    likesCount: 74,
    viewsCount: 310,
    tags: ['PLUMBING', 'LOCAL_SERVICE'],
  },
  {
    creatorKey: 'ai_dev_br',
    daysAgo: 0,
    title: "I connected ChatGPT directly to a company's ERP and eliminated 3 hours of manual data entry",
    contentText:
      'Case study with a visual flowchart: GPT-4o reading incoming orders, validating against ERP inventory, and writing back structured records — zero manual entry, 3 hours/day reclaimed.',
    mediaUrl: 'https://cdn.matchservice.dev/seed/day7-erp-automation-flowchart.jpg',
    likesCount: 268,
    viewsCount: 1450,
    tags: ['AI_AUTOMATION', 'SaaS'],
  },
];

/**
 * Radar sources — the content engine behind "o app não é interativo".
 *
 * Weighted toward Brazilian Portuguese business publishing, with every
 * NewsCategory covered so the filter bar is never empty, several YouTube
 * channel feeds so the feed has real video, and academic sources for the
 * theses/papers side.
 *
 * Only genuinely public, well-known feed endpoints are listed here — no
 * padding. If a publisher ever moves or kills its feed, ingestion records the
 * failure on NewsSource.lastError rather than breaking the run; flip `active`
 * to false to retire it.
 */
const NEWS_SOURCES: SeedNewsSource[] = [
  // --- Engenharia ---------------------------------------------------------
  {
    name: 'Massa Cinzenta (Cimento Itambé)',
    feedUrl: 'https://www.cimentoitambe.com.br/feed/',
    siteUrl: 'https://www.cimentoitambe.com.br',
    category: NewsCategory.ENGENHARIA,
  },
  {
    name: 'Sienge — Blog da Construção',
    feedUrl: 'https://www.sienge.com.br/blog/feed/',
    siteUrl: 'https://www.sienge.com.br',
    category: NewsCategory.ENGENHARIA,
  },
  {
    name: 'IEEE Spectrum',
    feedUrl: 'https://spectrum.ieee.org/feeds/feed.rss',
    siteUrl: 'https://spectrum.ieee.org',
    category: NewsCategory.ENGENHARIA,
    language: 'en',
  },
  {
    name: 'ScienceDaily — Engineering',
    feedUrl: 'https://www.sciencedaily.com/rss/matter_energy/engineering.xml',
    siteUrl: 'https://www.sciencedaily.com',
    category: NewsCategory.ENGENHARIA,
    mediaKind: NewsMediaKind.PAPER,
    language: 'en',
  },

  // --- Marketing ----------------------------------------------------------
  {
    name: 'Rock Content',
    feedUrl: 'https://rockcontent.com/br/blog/feed/',
    siteUrl: 'https://rockcontent.com/br',
    category: NewsCategory.MARKETING,
  },
  {
    name: 'RD Station',
    feedUrl: 'https://www.rdstation.com/blog/feed/',
    siteUrl: 'https://www.rdstation.com',
    category: NewsCategory.MARKETING,
  },
  {
    name: 'B9',
    feedUrl: 'https://www.b9.com.br/feed/',
    siteUrl: 'https://www.b9.com.br',
    category: NewsCategory.MARKETING,
  },

  // --- Publicidade --------------------------------------------------------
  {
    name: 'Meio & Mensagem',
    feedUrl: 'https://www.meioemensagem.com.br/feed',
    siteUrl: 'https://www.meioemensagem.com.br',
    category: NewsCategory.PUBLICIDADE,
  },
  {
    name: 'Adnews',
    feedUrl: 'https://adnews.com.br/feed/',
    siteUrl: 'https://adnews.com.br',
    category: NewsCategory.PUBLICIDADE,
  },
  {
    name: 'Propmark',
    feedUrl: 'https://propmark.com.br/feed/',
    siteUrl: 'https://propmark.com.br',
    category: NewsCategory.PUBLICIDADE,
  },

  // --- Finanças -----------------------------------------------------------
  {
    name: 'InfoMoney',
    feedUrl: 'https://www.infomoney.com.br/feed/',
    siteUrl: 'https://www.infomoney.com.br',
    category: NewsCategory.FINANCAS,
  },
  {
    name: 'g1 — Economia',
    feedUrl: 'https://g1.globo.com/rss/g1/economia/',
    siteUrl: 'https://g1.globo.com/economia',
    category: NewsCategory.FINANCAS,
  },
  {
    name: 'arXiv — Quantitative Finance (q-fin.GN)',
    feedUrl: 'https://rss.arxiv.org/rss/q-fin.GN',
    siteUrl: 'https://arxiv.org',
    category: NewsCategory.FINANCAS,
    mediaKind: NewsMediaKind.PAPER,
    language: 'en',
  },

  // --- Tecnologia ---------------------------------------------------------
  {
    name: 'Tecnoblog',
    feedUrl: 'https://tecnoblog.net/feed/',
    siteUrl: 'https://tecnoblog.net',
    category: NewsCategory.TECNOLOGIA,
  },
  {
    name: 'Olhar Digital',
    feedUrl: 'https://olhardigital.com.br/feed/',
    siteUrl: 'https://olhardigital.com.br',
    category: NewsCategory.TECNOLOGIA,
  },
  {
    name: 'Canaltech',
    feedUrl: 'https://canaltech.com.br/rss/',
    siteUrl: 'https://canaltech.com.br',
    category: NewsCategory.TECNOLOGIA,
  },
  {
    name: 'g1 — Tecnologia',
    feedUrl: 'https://g1.globo.com/rss/g1/tecnologia/',
    siteUrl: 'https://g1.globo.com/tecnologia',
    category: NewsCategory.TECNOLOGIA,
  },
  {
    // YouTube exposes every channel as an Atom feed at this endpoint — the
    // entries carry <media:group>, which is where the thumbnail comes from.
    name: 'Google for Developers (YouTube)',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw',
    siteUrl: 'https://www.youtube.com',
    category: NewsCategory.TECNOLOGIA,
    mediaKind: NewsMediaKind.VIDEO,
    language: 'en',
  },

  // --- Gestão -------------------------------------------------------------
  {
    name: 'Exame',
    feedUrl: 'https://exame.com/feed/',
    siteUrl: 'https://exame.com',
    category: NewsCategory.GESTAO,
  },
  {
    name: 'Época Negócios',
    feedUrl: 'https://epocanegocios.globo.com/rss/ultimas/feed.xml',
    siteUrl: 'https://epocanegocios.globo.com',
    category: NewsCategory.GESTAO,
  },
  {
    name: 'arXiv — General Economics (econ.GN)',
    feedUrl: 'https://rss.arxiv.org/rss/econ.GN',
    siteUrl: 'https://arxiv.org',
    category: NewsCategory.GESTAO,
    mediaKind: NewsMediaKind.PAPER,
    language: 'en',
  },
  {
    name: 'TED (YouTube)',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCAuUUnT6oDeKwE6v1NGQxug',
    siteUrl: 'https://www.youtube.com',
    category: NewsCategory.GESTAO,
    mediaKind: NewsMediaKind.VIDEO,
    language: 'en',
  },

  // --- Empreendedorismo ---------------------------------------------------
  {
    name: 'Startupi',
    feedUrl: 'https://startupi.com.br/feed/',
    siteUrl: 'https://startupi.com.br',
    category: NewsCategory.EMPREENDEDORISMO,
  },
  {
    name: 'Endeavor Brasil',
    feedUrl: 'https://endeavor.org.br/feed/',
    siteUrl: 'https://endeavor.org.br',
    category: NewsCategory.EMPREENDEDORISMO,
  },
  {
    name: 'Pequenas Empresas & Grandes Negócios',
    feedUrl: 'https://revistapegn.globo.com/rss/ultimas/feed.xml',
    siteUrl: 'https://revistapegn.globo.com',
    category: NewsCategory.EMPREENDEDORISMO,
  },
  {
    name: 'Y Combinator (YouTube)',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCcefcZRL2oaA_uBNeo5UOWg',
    siteUrl: 'https://www.youtube.com',
    category: NewsCategory.EMPREENDEDORISMO,
    mediaKind: NewsMediaKind.VIDEO,
    language: 'en',
  },
];

async function main() {
  console.log('Seeding MatchService launch-week Discovery Feed content...');

  // Clean slate — avoids duplicate posts/tags on repeated `prisma db seed`
  // runs. Both deletes are scoped to the seed creators' own posts: an
  // unscoped postTag.deleteMany({}) would strip the tags off posts written
  // by real users, which matters the moment this is run against a database
  // that isn't empty.
  const seedEmails = CREATORS.map((c) => c.email);
  await prisma.postTag.deleteMany({
    where: { post: { user: { email: { in: seedEmails } } } },
  });
  await prisma.discoveryPost.deleteMany({
    where: { user: { email: { in: seedEmails } } },
  });

  const creatorIds = new Map<string, string>();

  for (const creator of CREATORS) {
    const user = await prisma.user.upsert({
      where: { email: creator.email },
      update: {},
      create: {
        email: creator.email,
        passwordHash: SEED_PASSWORD_HASH,
        role: creator.role,
        country: creator.country,
        profile: {
          create: {
            name: creator.name,
            bio: creator.bio,
            skills: creator.skills,
            b2bNetworking: creator.b2bNetworking ?? false,
            rateCurrency: creator.country === 'BR' ? Currency.BRL : Currency.USD,
          },
        },
        subscription: {
          create: { currency: creator.country === 'BR' ? Currency.BRL : Currency.USD },
        },
      },
    });
    creatorIds.set(creator.key, user.id);
  }

  const now = Date.now();

  for (const post of POSTS) {
    const creatorId = creatorIds.get(post.creatorKey);
    if (!creatorId) throw new Error(`Unknown creator key: ${post.creatorKey}`);

    await prisma.discoveryPost.create({
      data: {
        userId: creatorId,
        title: post.title,
        contentText: post.contentText,
        mediaUrl: post.mediaUrl,
        videoDurationSeconds: post.videoDurationSeconds,
        likesCount: post.likesCount,
        viewsCount: post.viewsCount,
        createdAt: new Date(now - post.daysAgo * DAY_MS),
        tags: { create: post.tags.map((tagName) => ({ tagName })) },
      },
    });
  }

  // --- VibeAcademy catalogue -------------------------------------------
  // Same scoped-reset reasoning as the posts above: only remove what this
  // seed owns, identified by its own instructors.
  const seedInstructorIds = [...creatorIds.values()];
  await prisma.businessCourse.deleteMany({ where: { instructorId: { in: seedInstructorIds } } });

  for (const course of COURSES) {
    const instructorId = creatorIds.get(course.instructorKey);
    if (!instructorId) throw new Error(`Unknown instructor key: ${course.instructorKey}`);
    const creator = CREATORS.find((c) => c.key === course.instructorKey)!;

    await prisma.businessCourse.create({
      data: {
        instructorId,
        title: course.title,
        description: course.description,
        price: course.price,
        currency: creator.country === 'BR' ? Currency.BRL : Currency.USD,
        rating: course.rating,
        skillsTaught: course.skillsTaught,
        modules: {
          create: course.modules.map((title, orderIndex) => ({
            orderIndex,
            title,
            // Real scripts come from AiCourseFactoryService; the seed only
            // needs enough text for the module list to render.
            voiceScript: `Roteiro do módulo "${title}" — conteúdo gerado no lançamento.`,
          })),
        },
      },
    });
  }

  // --- Live Masterminds --------------------------------------------------
  await prisma.liveMastermindSession.deleteMany({ where: { hostId: { in: seedInstructorIds } } });

  for (const session of MASTERMINDS) {
    const hostId = creatorIds.get(session.hostKey);
    if (!hostId) throw new Error(`Unknown host key: ${session.hostKey}`);
    const host = CREATORS.find((c) => c.key === session.hostKey)!;

    await prisma.liveMastermindSession.create({
      data: {
        hostId,
        title: session.title,
        accessFee: session.accessFee,
        currency: host.country === 'BR' ? Currency.BRL : Currency.USD,
        scheduledFor: new Date(now + session.daysFromNow * DAY_MS),
      },
    });
  }

  // --- Mentors directory --------------------------------------------------
  // Only the three curated creators get `isMentor`; everyone else is left
  // untouched, so re-running the seed never promotes a real user by accident.
  for (const mentor of MENTORS) {
    const userId = creatorIds.get(mentor.creatorKey);
    if (!userId) throw new Error(`Unknown mentor key: ${mentor.creatorKey}`);

    await prisma.userProfile.update({
      where: { userId },
      data: {
        isMentor: true,
        mentorHeadline: mentor.headline,
        mentorTopics: mentor.topics,
      },
    });
  }

  // --- Mentoria individual (one-to-one) -----------------------------------
  // Same scoped-reset rule as everywhere else in this file: bookings are
  // removed first and scoped both ways (a seat held BY a seeded user, and a
  // seat ON an offering hosted by one), then the offerings themselves. The
  // offering delete would cascade to slots and bookings anyway; doing it
  // explicitly keeps a real user's booking on a real mentor's calendar out of
  // the blast radius.
  await prisma.mentorshipBooking.deleteMany({
    where: {
      OR: [{ menteeId: { in: seedInstructorIds } }, { offering: { mentorId: { in: seedInstructorIds } } }],
    },
  });
  await prisma.mentorshipOffering.deleteMany({ where: { mentorId: { in: seedInstructorIds } } });

  for (const offering of MENTORSHIP_OFFERINGS) {
    const mentorId = creatorIds.get(offering.mentorKey);
    if (!mentorId) throw new Error(`Unknown mentorship mentor key: ${offering.mentorKey}`);

    await prisma.mentorshipOffering.create({
      data: {
        mentorId,
        title: offering.title,
        description: offering.description,
        durationMinutes: offering.durationMinutes,
        price: offering.price,
        // All three mentors are BR — priced in the currency the buyer pays in.
        currency: Currency.BRL,
        topics: offering.topics,
        slots: {
          create: offering.slotOffsets.map((slot) => ({
            startsAt: slotInstant(now, slot.daysFromNow, slot.hour),
          })),
        },
      },
    });
  }

  // --- Diagnósticos de crescimento ----------------------------------------
  await prisma.growthDiagnostic.deleteMany({ where: { userId: { in: seedInstructorIds } } });

  for (const diagnostic of DIAGNOSTICS) {
    const userId = creatorIds.get(diagnostic.userKey);
    if (!userId) throw new Error(`Unknown diagnostic user key: ${diagnostic.userKey}`);

    await prisma.growthDiagnostic.create({
      data: {
        userId,
        situation: diagnostic.situation,
        scoreVendas: diagnostic.scores.vendas,
        scoreGestao: diagnostic.scores.gestao,
        scoreTecnologia: diagnostic.scores.tecnologia,
        scoreFinancas: diagnostic.scores.financas,
        weakestPillar: diagnostic.weakestPillar,
        summary: diagnostic.summary,
        recommendations: diagnostic.recommendations,
        suggestedSkills: diagnostic.suggestedSkills,
        // These readings were produced by the local analyser, not the model —
        // recording that honestly is the whole point of the flag.
        aiGenerated: false,
        createdAt: new Date(now - diagnostic.daysAgo * DAY_MS),
      },
    });
  }

  // K-SCORE rows for the seeded providers — without them every mentor ranks
  // at 0 and the Círculos' `minKScore` gate can't be exercised on a fresh DB.
  for (const score of PROVIDER_SCORES) {
    const providerId = creatorIds.get(score.creatorKey);
    if (!providerId) throw new Error(`Unknown score key: ${score.creatorKey}`);

    await prisma.providerScore.upsert({
      where: { providerId },
      update: { financialHealthScore: score.kScore, completedJobsCount: score.completedJobs },
      create: {
        providerId,
        financialHealthScore: score.kScore,
        completedJobsCount: score.completedJobs,
      },
    });
  }

  // --- Conteúdo (editorial hub) -------------------------------------------
  // Same scoped-reset rule as the courses above: only articles authored by
  // this seed's own users are removed.
  await prisma.article.deleteMany({ where: { authorId: { in: seedInstructorIds } } });

  for (const article of ARTICLES) {
    const authorId = creatorIds.get(article.authorKey);
    if (!authorId) throw new Error(`Unknown article author key: ${article.authorKey}`);

    const publishedAt = new Date(now - article.daysAgo * DAY_MS);

    await prisma.article.create({
      data: {
        authorId,
        slug: await uniqueArticleSlug(article.title),
        title: article.title,
        excerpt: article.excerpt,
        body: article.body,
        // Null on purpose — the client renders a generated gradient, which
        // beats a hotlinked image that 404s on launch day.
        coverImageUrl: null,
        category: article.category,
        readMinutes: estimateReadMinutes(article.body),
        status: ArticleStatus.PUBLISHED,
        viewCount: article.viewCount,
        publishedAt,
        createdAt: publishedAt,
      },
    });
  }

  // --- Comunidades ("Círculos") -------------------------------------------
  // Memberships are deleted first and scoped both ways: seats held BY a
  // seeded user, and seats in a community hosted by one. The community delete
  // would cascade, but being explicit keeps a real user's seat in a real
  // community out of the blast radius.
  await prisma.communityMembership.deleteMany({
    where: {
      OR: [{ userId: { in: seedInstructorIds } }, { community: { hostId: { in: seedInstructorIds } } }],
    },
  });
  await prisma.community.deleteMany({ where: { hostId: { in: seedInstructorIds } } });

  const communityIds = new Map<string, string>();

  for (const community of COMMUNITIES) {
    const hostId = creatorIds.get(community.hostKey);
    if (!hostId) throw new Error(`Unknown community host key: ${community.hostKey}`);

    const created = await prisma.community.create({
      data: {
        hostId,
        tier: community.tier,
        name: community.name,
        tagline: community.tagline,
        description: community.description,
        monthlyFee: community.monthlyFee,
        currency: Currency.BRL,
        seatLimit: community.seatLimit,
        cadence: community.cadence,
        minKScore: community.minKScore,
        focusTopics: community.focusTopics,
      },
    });
    communityIds.set(community.key, created.id);
  }

  for (const membership of MEMBERSHIPS) {
    const communityId = communityIds.get(membership.communityKey);
    if (!communityId) throw new Error(`Unknown community key: ${membership.communityKey}`);
    const userId = creatorIds.get(membership.memberKey);
    if (!userId) throw new Error(`Unknown member key: ${membership.memberKey}`);

    await prisma.communityMembership.create({
      data: {
        communityId,
        userId,
        // Seeded seats are ACTIVE directly: they represent members who already
        // paid. A seat created through the API only reaches ACTIVE via the
        // Stripe webhook.
        status: MembershipStatus.ACTIVE,
        askedCount: membership.askedCount,
        answeredCount: membership.answeredCount,
        contributionScore: deriveContributionScore(membership.askedCount, membership.answeredCount),
      },
    });
  }

  // --- Radar (external news sources) --------------------------------------
  // Upsert-by-feedUrl rather than the delete-then-create shape used above,
  // and deliberately so: NewsItem cascades off NewsSource, and SavedNewsItem
  // cascades off NewsItem. A `deleteMany` here would throw away every
  // ingested article AND every bookmark a real user had saved, just because
  // someone re-ran the seed. Upserting is still scoped the same way the other
  // resets are — it only ever touches rows whose feedUrl is in this list, and
  // a source an operator added by hand is left alone.
  //
  // `active` is intentionally absent from the update payload: an operator who
  // disabled a rotten feed shouldn't have it silently switched back on.
  for (const source of NEWS_SOURCES) {
    await prisma.newsSource.upsert({
      where: { feedUrl: source.feedUrl },
      update: {
        name: source.name,
        siteUrl: source.siteUrl,
        category: source.category,
        mediaKind: source.mediaKind ?? NewsMediaKind.ARTICLE,
        language: source.language ?? 'pt',
      },
      create: {
        name: source.name,
        feedUrl: source.feedUrl,
        siteUrl: source.siteUrl,
        category: source.category,
        mediaKind: source.mediaKind ?? NewsMediaKind.ARTICLE,
        language: source.language ?? 'pt',
      },
    });
  }

  console.log(
    `Seeded ${CREATORS.length} creators, ${POSTS.length} Discovery Feed posts, ` +
      `${COURSES.length} courses, ${MASTERMINDS.length} masterminds, ${MENTORS.length} mentors, ` +
      `${MENTORSHIP_OFFERINGS.length} mentorship offerings, ${DIAGNOSTICS.length} growth diagnostics, ` +
      `${ARTICLES.length} articles, ${COMMUNITIES.length} communities with ${MEMBERSHIPS.length} active seats ` +
      `and ${NEWS_SOURCES.length} Radar news sources.`,
  );
}

/**
 * Resolves a slot offset against the seed's own `now`, normalized to the top
 * of the hour in the server's timezone. Offsets rather than fixed dates so a
 * database seeded today always has bookable slots in the future — an offering
 * whose slots have all passed never appears in GET /mentorship/offerings.
 */
function slotInstant(now: number, daysFromNow: number, hour: number): Date {
  const instant = new Date(now + daysFromNow * DAY_MS);
  instant.setHours(hour, 0, 0, 0);
  return instant;
}

/**
 * Same collision rule ContentService applies: append `-2`, `-3`, ... until the
 * slug is free. Seeded articles are deleted first, so this only ever collides
 * with a real user's article that happens to share a title.
 */
async function uniqueArticleSlug(title: string): Promise<string> {
  const base = slugify(title) || 'artigo';
  let candidate = base;
  let suffix = 1;

  while (await prisma.article.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
