import { Currency, PrismaClient, Role, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Deterministic generator for *simulated* marketplace population.
 *
 * Lives outside the Nest service on purpose: `prisma/seed-simulation.ts`
 * (run straight from the production console, no HTTP) and
 * `SimulationService` (POST /admin/simulation/users) must produce byte-for-byte
 * the same people, so the generation rules and the Prisma writes live here
 * once and both callers delegate to them. Nothing in this file imports Nest —
 * it is plain TypeScript over `PrismaClient`, which `PrismaService` extends.
 *
 * Two invariants make this safe to run against a real database:
 *
 *  1. Every simulated account lives on the reserved e-mail domain
 *     `@simulado.vibematch.dev`. That domain is never issued to a real
 *     signup, so `DELETE /admin/simulation/users` can purge by suffix and be
 *     provably incapable of touching a real account.
 *  2. Randomness is seeded from the person's index, never from the clock.
 *     The same index always yields the same human, so a bug reported against
 *     "the 34th simulated provider" is reproducible, and re-running the
 *     generator upserts the same rows instead of inventing new strangers.
 */

/** Reserved domain — the whole cleanup story depends on nothing else using it. */
export const SIMULATED_EMAIL_DOMAIN = 'simulado.vibematch.dev';

/**
 * Same constant password as `prisma/seed.ts`, so every simulated account can
 * actually be logged into while testing.
 */
export const SIMULATED_USER_PASSWORD = 'MatchService#Seed2026';

/** Hard ceiling on the simulated population — a runaway loop must not fill the users table. */
export const MAX_SIMULATED_USERS = 500;

/** Default population size for the standalone script. */
export const DEFAULT_SIMULATION_COUNT = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const SPREAD_DAYS = 90;

export type SimulatedCountry = 'BR' | 'US';
export type SimulatedRole = Extract<Role, 'PROVIDER' | 'CLIENT' | 'BOTH'>;

export interface SimulationOptions {
  country?: SimulatedCountry;
  role?: SimulatedRole;
  /** Epoch millis the 90-day `createdAt` spread is measured back from. Injectable so tests are stable. */
  now?: number;
}

export interface SimulatedScore {
  financialHealthScore: number;
  reliabilityRate: number;
  responseTimeMinutes: number;
  completedJobsCount: number;
}

export interface SimulatedPerson {
  index: number;
  email: string;
  name: string;
  role: SimulatedRole;
  country: SimulatedCountry;
  specialty: string;
  bio: string;
  skills: string[];
  hourlyRate: number;
  rateCurrency: Currency;
  averageRating: number;
  city: string;
  latitude: number;
  longitude: number;
  b2bNetworking: boolean;
  proProvider: boolean;
  createdAt: Date;
  score: SimulatedScore;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32 — a tiny, well-distributed 32-bit PRNG. `Math.random()` scattered
 * through generation would make "the same request twice" unpredictable and
 * any reported bug unreproducible; this is seeded purely from the index.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Accent-stripped, URL-safe form of a person's name — the local part of their e-mail. */
export function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Source material
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Ana Luiza', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
  'Isabela', 'João Pedro', 'Karina', 'Leandro', 'Mariana', 'Nathalia', 'Otávio', 'Patrícia',
  'Rafael', 'Sabrina', 'Thiago', 'Vanessa', 'Wagner', 'Yasmin', 'André', 'Beatriz',
  'Caio', 'Débora', 'Emerson', 'Fernanda', 'Gustavo', 'Helena', 'Ícaro', 'Juliana',
  'Kléber', 'Larissa', 'Marcelo', 'Natália', 'Priscila', 'Renato', 'Simone', 'Tatiana',
] as const;

const LAST_NAMES = [
  'Almeida', 'Barbosa', 'Cavalcanti', 'Duarte', 'Esteves', 'Fontes', 'Gonçalves', 'Hirata',
  'Iglesias', 'Jardim', 'Klein', 'Lacerda', 'Medeiros', 'Nogueira', 'Oliveira', 'Pacheco',
  'Queiroz', 'Rezende', 'Sampaio', 'Teixeira', 'Uchôa', 'Vasconcelos', 'Werneck', 'Xavier',
  'Zanetti', 'Bittencourt', 'Carvalho', 'Dantas', 'Figueiredo', 'Guimarães', 'Machado',
  'Nascimento', 'Peixoto', 'Ribeiro', 'Siqueira', 'Tavares',
] as const;

/**
 * Real Brazilian city centres. Each generated profile is scattered within a
 * few kilometres of one of them, so `GET /swipes/stack?mode=LOCAL` has genuine
 * distances to sort by instead of a pile of identical coordinates.
 */
const CITIES = [
  { name: 'São Paulo', latitude: -23.5505, longitude: -46.6333 },
  { name: 'Rio de Janeiro', latitude: -22.9068, longitude: -43.1729 },
  { name: 'Belo Horizonte', latitude: -19.9167, longitude: -43.9345 },
  { name: 'Curitiba', latitude: -25.4284, longitude: -49.2733 },
  { name: 'Porto Alegre', latitude: -30.0346, longitude: -51.2177 },
  { name: 'Recife', latitude: -8.0476, longitude: -34.877 },
  { name: 'Florianópolis', latitude: -27.5954, longitude: -48.548 },
] as const;

interface Specialty {
  key: string;
  /**
   * 3–5 tags drawn from the market-standard vocabulary already in use in
   * `prisma/seed.ts` and `ai-factory.service.ts` — deliberately NOT a new
   * parallel taxonomy, so course-connections and feed tag matching keep working.
   */
  skills: string[];
  /** Hourly rate band in BRL; USD profiles are derived from this (see `buildSimulatedPerson`). */
  rateBrl: [number, number];
  /** Genuinely written bios in the voice of the specialty — one is picked per person. */
  bios: string[];
}

const SPECIALTIES: Specialty[] = [
  {
    key: 'Automação com IA',
    skills: ['AI_AUTOMATION', 'MAKE', 'SaaS', 'BACKEND'],
    rateBrl: [180, 380],
    bios: [
      'Tiro processo manual do caminho de gente cara. Monto fluxos no Make ligando formulário, CRM e planilha, e deixo tudo documentado para o time operar sem depender de mim. Já devolvi mais de vinte horas por semana em operações de 30 a 80 pessoas.',
      'Trabalho com automação em empresa que já tem processo, não com quem ainda está descobrindo o próprio funil. Começo medindo quanto tempo a tarefa consome hoje, automatizo um fluxo por vez e só amplio quando o primeiro sobrevive trinta dias sem manutenção.',
      'Sou o cara que a empresa chama quando a automação que alguém montou às pressas quebrou e ninguém sabe por onde ela passa. Refaço o fluxo com log, alerta de falha e um manual em texto simples, para que a próxima pessoa não precise adivinhar nada.',
      'Construo agentes de IA que conversam com o CRM de verdade, não demonstração bonita que não escreve em lugar nenhum. Meu critério é simples: se a automação não reduzir uma hora recorrente por semana, eu digo que não vale a pena e não cobro pelo diagnóstico.',
    ],
  },
  {
    key: 'Integrações de pagamento',
    skills: ['STRIPE_WEBHOOK', 'PAYMENTS', 'BACKEND'],
    rateBrl: [200, 420],
    bios: [
      'Passo meus dias dentro de checkout e webhook. Já resgatei assinatura que cobrava duas vezes, cobrança que sumia sem log e conciliação que não fechava com o extrato do gateway. Entrego com teste de retry e um painel simples de eventos falhados.',
      'Especialista em cobrança recorrente: assinatura, upgrade no meio do ciclo, retentativa de cartão recusado e cancelamento que precisa parar de faturar no dia certo. Se o seu financeiro concilia no olho toda segunda-feira, eu resolvo isso.',
      'Integro Stripe e Pix no mesmo fluxo sem duplicar regra de negócio. Meu foco é o que acontece depois do pagamento: liberar acesso, emitir a cobrança seguinte e avisar o time quando algo falhar, em vez de descobrir pelo cliente reclamando.',
      'Trabalhei três anos em produto de assinatura e vi de perto quanto dinheiro escapa por webhook mal validado. Hoje faço auditoria de fluxo de pagamento e corrijo a rota inteira, do endpoint à baixa no financeiro.',
    ],
  },
  {
    key: 'Backend e APIs',
    skills: ['BACKEND', 'SaaS', 'PAYMENTS'],
    rateBrl: [170, 360],
    bios: [
      'Backend em Node e Postgres para produto que já tem cliente pagando. Gosto de entrar em base legada, entender por que a rota está lenta e devolver o tempo de resposta ao patamar de antes, sem reescrever tudo do zero.',
      'Construo API que outro time consegue usar sem me perguntar nada: contrato claro, erro com mensagem útil e documentação que acompanha a mudança. Já mantive integração pública consumida por parceiros externos por dois anos.',
      'Meu trabalho costuma começar por um incidente. Levanto o gargalo, coloco métrica onde não tinha, arrumo a consulta que varre a tabela inteira e deixo alerta configurado para o problema não voltar em silêncio.',
      'Trabalho com times pequenos que precisam de senioridade pontual: revisão de arquitetura, modelagem de banco antes do produto crescer e a parte chata de migração de dados que ninguém quer assumir.',
    ],
  },
  {
    key: 'Edição de vídeo curto',
    skills: ['VIDEO_EDITING', 'SHORT_FORM', 'DESIGN'],
    rateBrl: [90, 220],
    bios: [
      'Edito vertical para Reels e TikTok com foco em retenção nos três primeiros segundos. Entrego duas versões de gancho para o mesmo vídeo, porque testar o começo custa dez minutos e muda o alcance inteiro.',
      'Venho de redação, não de motion: corto pensando no que a pessoa precisa entender em cada frase, não no efeito. Trabalho com empresa de serviço que grava no celular e quer parecer profissional sem montar estúdio.',
      'Faço edição de conteúdo falado — aula, depoimento de cliente, bastidor de obra. Limpo respiração, ajusto ritmo, legendo em português correto e devolvo em até 48 horas com os arquivos organizados por data.',
      'Trabalho com volume: fecho pacote mensal de doze a vinte cortes a partir de lives e podcasts. Recebo o bruto, escolho os trechos que sustentam sozinhos e devolvo com capa e legenda prontas para publicar.',
    ],
  },
  {
    key: 'Conteúdo de marca em vídeo',
    skills: ['VIDEO_EDITING', 'SHORT_FORM', 'DESIGN', 'STARTUPS'],
    rateBrl: [120, 280],
    bios: [
      'Cuido do vídeo institucional que não parece institucional. Roteiro curto, gravação em meio dia na própria empresa e entrega em três formatos: site, LinkedIn e vertical. Já fiz isso para indústria, clínica e escritório de contabilidade.',
      'Ajudo empresa técnica a explicar o que vende sem jargão. Monto o roteiro junto com quem entende do assunto, gravo com o próprio especialista e edito para caber em noventa segundos sem perder a parte que convence.',
      'Trabalho com lançamento de produto: teaser, vídeo de demonstração e os cortes que sustentam a campanha nas duas semanas seguintes. Entrego um calendário de publicação junto, para o material não morrer na pasta.',
      'Sou editor com olho de marca. Padronizo tipografia, cor e ritmo entre todas as peças, para que a empresa pare de parecer três empresas diferentes dependendo de quem gravou.',
    ],
  },
  {
    key: 'UI/UX de produto',
    skills: ['UI_UX', 'DESIGN', 'SaaS'],
    rateBrl: [160, 340],
    bios: [
      'Desenho painel de SaaS com muita informação e pouco espaço. Meu foco é ativação: o que a pessoa precisa ver no primeiro acesso para entender que o produto funciona, e o que pode esperar a segunda semana.',
      'Faço redesenho com dado na mão. Antes de mexer em tela, olho onde o usuário abandona o fluxo e converso com cinco clientes reais. Boa parte do trabalho acaba sendo cortar coisa, não adicionar.',
      'Trabalho com time de engenharia pequeno, então entrego design que dá para construir: componente reaproveitado, estado vazio pensado e as telas de erro que geralmente ficam para depois e nunca chegam.',
      'Venho de pesquisa com usuário e migrei para produto. Faço o ciclo inteiro: entrevista, protótipo navegável, teste com cinco pessoas e ajuste antes de qualquer linha de código.',
    ],
  },
  {
    key: 'Design system e identidade',
    skills: ['DESIGN', 'UI_UX', 'STARTUPS'],
    rateBrl: [150, 320],
    bios: [
      'Monto design system para empresa que já tem produto e cansou de retrabalho. Componente, token de cor, regra de espaçamento e documentação viva — o suficiente para dois designers trabalharem sem se contradizer.',
      'Faço identidade visual para empresa B2B que precisa parecer sólida sem parecer fria. Entrego marca, aplicação em apresentação comercial e um guia curto que o time consegue seguir sem me chamar.',
      'Especialista em padronizar o que já existe. Levanto todas as telas e peças em uso, agrupo o que é a mesma coisa com nomes diferentes e devolvo uma biblioteca única com o que sobrou.',
      'Trabalho na fronteira entre marca e produto: garanto que a apresentação de vendas, o site e o app pareçam a mesma empresa. É um trabalho chato que quase ninguém faz e que muda a percepção de preço.',
    ],
  },
  {
    key: 'Encanamento residencial',
    skills: ['PLUMBING', 'LOCAL_SERVICE', 'MAINTENANCE'],
    rateBrl: [80, 180],
    bios: [
      'Encanador há quinze anos, atendendo apartamento e casa na região. Faço caça-vazamento sem quebrar parede à toa, troca de coluna e reparo de emergência. Chego no horário combinado e limpo o serviço antes de sair.',
      'Trabalho com manutenção preventiva para condomínio e imobiliária: revisão de registro, caixa d\'água e infiltração antes de virar obra cara. Emito relatório com foto de cada ponto verificado.',
      'Atendo reforma de banheiro e cozinha do zero: tubulação, teste de pressão e acabamento entregue pronto para o azulejista. Trabalho com orçamento fechado e aviso antes se algo mudar.',
      'Sou encanador e faço questão de explicar o problema antes de propor solução. Boa parte dos chamados que recebo é conserto de serviço mal feito, então prefiro mostrar a causa e deixar o cliente decidir com informação.',
    ],
  },
  {
    key: 'Instalação de pisos',
    skills: ['FLOOR_INSTALLATION', 'LOCAL_SERVICE', 'MAINTENANCE'],
    rateBrl: [70, 160],
    bios: [
      'Instalo vinílico, laminado e porcelanato em obra residencial e comercial. Faço a preparação do contrapiso direito, que é onde quase todo problema de piso começa, e entrego com rodapé alinhado.',
      'Trabalho com restauração: recupero piso de madeira antigo, corrijo desnível e substituo régua danificada sem trocar o ambiente inteiro. Muita gente descobre que dá para salvar o que já tem.',
      'Especialista em prazo curto para loja e escritório. Já entreguei trezentos metros quadrados em fim de semana para o cliente abrir na segunda, com equipe própria e material conferido antes.',
      'Faço instalação e depois volto para revisar. Piso trabalha nos primeiros meses, e uma visita de ajuste evita a reclamação que vira retrabalho grande. Está incluso no que eu cobro.',
    ],
  },
  {
    key: 'Manutenção predial',
    skills: ['MAINTENANCE', 'LOCAL_SERVICE', 'FLOOR_INSTALLATION'],
    rateBrl: [90, 200],
    bios: [
      'Cuido da manutenção de prédio comercial e condomínio: elétrica, hidráulica, pintura e pequenos reparos, com plano mensal e ordem de serviço registrada. O síndico deixa de apagar incêndio por WhatsApp.',
      'Atendo empresa que não tem time de facilities. Faço a ronda quinzenal, listo o que está prestes a quebrar e priorizo pelo custo de deixar quebrar. É mais barato do que chamar emergência três vezes por trimestre.',
      'Trabalho com retrofit leve: troca de luminária, revisão de quadro elétrico e pintura de área comum sem parar a operação do prédio. Faço em horário que não atrapalha morador nem cliente.',
      'Quinze anos em manutenção, os últimos seis coordenando equipe. Entrego relatório com foto de antes e depois, porque em prédio quem aprova o gasto quase nunca é quem viu o problema.',
    ],
  },
  {
    key: 'SEO local para serviços',
    skills: ['LOCAL_SEO', 'LOCAL_SERVICE', 'STARTUPS'],
    rateBrl: [110, 260],
    bios: [
      'Coloco empresa de serviço no mapa — literalmente. Arrumo o perfil do Google, padronizo endereço e telefone nos diretórios e trabalho avaliação de cliente de forma constante. O telefone toca mais em quatro a seis semanas.',
      'Trabalho só com negócio local: clínica, oficina, escritório, prestador de serviço. Meu indicador não é posição no ranking, é quantos pedidos de orçamento entraram no mês. O resto é vaidade.',
      'Faço conteúdo local que responde a pergunta que o cliente digita antes de contratar: quanto custa, quanto demora e o que dá errado. É menos glamouroso do que blog institucional e traz orçamento de verdade.',
      'Já recuperei perfil suspenso, endereço duplicado e ficha com telefone antigo — o tipo de problema que derruba a busca por bairro inteiro. Começo sempre por uma auditoria de trinta minutos, sem custo.',
    ],
  },
  {
    key: 'Controladoria e BPO financeiro',
    skills: ['CONTROLLER', 'FINANCIAL_AUDIT', 'PAYMENTS'],
    rateBrl: [160, 350],
    bios: [
      'Organizo o financeiro de empresa entre 2 e 30 milhões de faturamento. Fecho o mês em até cinco dias úteis, com fluxo de caixa projetado de treze semanas e relatório que o dono entende sem contador do lado.',
      'Sou controller de aluguel para empresa que ainda não comporta um em tempo integral. Estruturo plano de contas, centro de custo e rotina de conciliação, treino o time e depois saio de cena.',
      'Meu trabalho começa quase sempre no mesmo lugar: separar o que é caixa do que é resultado. Empresa lucrativa que vive apertada geralmente tem problema de prazo, não de margem, e isso se resolve com rotina.',
      'Atuo com controladoria para serviço e comércio, com foco em margem por cliente e por contrato. Já mostrei para três empresas que o maior cliente delas era o menos rentável, e o que fazer a respeito.',
    ],
  },
  {
    key: 'Auditoria e compliance financeiro',
    skills: ['FINANCIAL_AUDIT', 'CONTROLLER', 'PAYMENTS', 'SaaS'],
    rateBrl: [180, 400],
    bios: [
      'Faço auditoria de processo financeiro antes de rodada, venda de participação ou entrada de sócio. Levanto o que não está documentado, aponto o risco em ordem de gravidade e ajudo a corrigir antes de alguém de fora perguntar.',
      'Especialista em conciliação de gateway e marketplace: onde a venda registrada não bate com o dinheiro que entrou. Já encontrei diferença acumulada de seis dígitos em operação que ninguém suspeitava.',
      'Trabalho com empresa que cresceu rápido e tem controle de planilha. Monto trilha de auditoria, alçada de aprovação e segregação de função sem transformar o dia a dia em burocracia paralisante.',
      'Venho de auditoria em firma grande e hoje atendo empresa média, que tem os mesmos riscos e um décimo da estrutura. Entrego relatório objetivo, com prazo e responsável para cada ponto.',
    ],
  },
  {
    key: 'Parcerias e desenvolvimento B2B',
    skills: ['B2B_NETWORKING', 'STARTUPS', 'SaaS'],
    rateBrl: [150, 330],
    bios: [
      'Estruturo canal de parceiros para empresa B2B: quem indica, o que ganha, como o repasse é medido e o que a parceria precisa entregar para valer a pena. Sem isso, parceria vira almoço com aperto de mão.',
      'Abro portas em mercado que exige apresentação. Trabalho com lista curta de contas nomeadas, não com disparo em massa, e devolvo relatório do que cada conversa revelou sobre o mercado.',
      'Ajudo empresa de serviço a vender para empresa maior, o que é um jogo diferente: prazo longo, várias pessoas decidindo e contrato com jurídico. Preparo material, proposta e o roteiro das reuniões.',
      'Passei oito anos em desenvolvimento de negócios em tecnologia e hoje faço isso como parceiro externo. Meu contrato tem fixo baixo e variável por contrato assinado, porque prefiro ganhar quando funciona.',
    ],
  },
  {
    key: 'Growth para SaaS',
    skills: ['SaaS', 'STARTUPS', 'LOCAL_SEO', 'B2B_NETWORKING'],
    rateBrl: [170, 360],
    bios: [
      'Trabalho o meio do funil de SaaS B2B, que é onde a maior parte do dinheiro fica parado: quem testou, gostou e não comprou. Monto sequência, prova social e a conversa comercial na hora certa.',
      'Cuido de ativação e retenção. Antes de investir em mais tráfego, olho quantos dos que entraram chegaram ao momento em que o produto faz sentido — e quase sempre esse número é o problema real.',
      'Faço experimentação com disciplina: uma hipótese por vez, métrica combinada antes, prazo de duas semanas. Documento tudo, inclusive o que não funcionou, porque isso vale mais do que o que deu certo.',
      'Venho de operação, não de agência. Já rodei o funil inteiro dentro de uma empresa de assinatura e hoje faço isso para times pequenos que precisam de método antes de precisar de orçamento de mídia.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Builds the Nth simulated person. Pure and total: same index + same options
 * always yields the same human (only `createdAt` is anchored to `now`).
 */
export function buildSimulatedPerson(index: number, options: SimulationOptions = {}): SimulatedPerson {
  // Offsetting the seed keeps index 0 from degenerating into a near-constant
  // stream, which mulberry32 does for very small seeds.
  const rng = mulberry32(index * 2654435761 + 0x9e3779b9);
  const now = options.now ?? Date.now();

  const firstName = pick(rng, FIRST_NAMES);
  const lastName = pick(rng, LAST_NAMES);
  const name = `${firstName} ${lastName}`;
  const email = `sim.${slugifyName(name)}.${index}@${SIMULATED_EMAIL_DOMAIN}`;

  const specialty = SPECIALTIES[index % SPECIALTIES.length];
  const bio = specialty.bios[Math.floor(rng() * specialty.bios.length)];

  // 3–5 skills: always the specialty's core tags, occasionally one extra so
  // profiles aren't uniform. Never invents a tag outside the shared vocabulary.
  const skillCount = Math.min(specialty.skills.length, 3 + Math.floor(rng() * 3));
  const skills = specialty.skills.slice(0, skillCount);

  const role: SimulatedRole = options.role ?? defaultRoleFor(index);
  const country: SimulatedCountry = options.country ?? 'BR';
  const rateCurrency = country === 'BR' ? Currency.BRL : Currency.USD;

  const rateBrl = between(rng, specialty.rateBrl[0], specialty.rateBrl[1]);
  // ~5.4 BRL/USD, rounded to a price a human would actually quote.
  const hourlyRate = country === 'BR' ? Math.round(rateBrl / 5) * 5 : Math.round(rateBrl / 5.4 / 5) * 5;

  const averageRating = round(between(rng, 3.8, 5.0), 1);

  const city = pick(rng, CITIES);
  // ±0.09° ≈ ±10 km — enough spread for LOCAL mode to produce a real distance
  // ordering, tight enough that everyone still reads as "in that city".
  const latitude = round(city.latitude + between(rng, -0.09, 0.09), 5);
  const longitude = round(city.longitude + between(rng, -0.09, 0.09), 5);

  const createdAt = new Date(now - Math.floor(between(rng, 0, SPREAD_DAYS) * DAY_MS));

  const score = buildScore(rng, averageRating);

  return {
    index,
    email,
    name,
    role,
    country,
    specialty: specialty.key,
    bio,
    skills,
    hourlyRate,
    rateCurrency,
    averageRating,
    city: city.name,
    latitude,
    longitude,
    // Exactly a third opt into B2B, so the Tinder B2B deck is never empty.
    b2bNetworking: index % 3 === 0,
    // A visible minority on PRO_PROVIDER so the CLOUD deck's paid-visibility
    // boost (`isProBoosted` in swipes.service.ts) is observable, not theoretical.
    proProvider: index % 7 === 0 && role !== Role.CLIENT,
    createdAt,
    score,
  };
}

/**
 * Skews heavily toward PROVIDER/BOTH when no role is forced — the swipe deck
 * only shows PROVIDER and BOTH, and an empty deck is the exact complaint this
 * generator exists to fix.
 */
function defaultRoleFor(index: number): SimulatedRole {
  const bucket = index % 10;
  if (bucket <= 6) return Role.PROVIDER;
  if (bucket <= 8) return Role.BOTH;
  return Role.CLIENT;
}

/**
 * Mirrors ScoreEngine's own blend (35% reliability / 25% response time /
 * 30% rating / 10% 90-day volume, scaled to 0–1000) rather than picking a
 * number out of the air, so a simulated provider's sub-signals and their
 * K-SCORE are mutually consistent — and a later real `recalculate()` won't
 * produce a jarring jump.
 */
function buildScore(rng: () => number, averageRating: number): SimulatedScore {
  const reliabilityRate = round(between(rng, 0.72, 1), 3);
  const responseTimeMinutes = round(between(rng, 6, 95), 1);
  const completedJobsCount = Math.floor(between(rng, 3, 71));
  const volume90d = between(rng, 800, 14000);

  const blended =
    reliabilityRate * 0.35 +
    clamp01(1 - responseTimeMinutes / 120) * 0.25 +
    clamp01(averageRating / 5) * 0.3 +
    clamp01(volume90d / 10000) * 0.1;

  return {
    reliabilityRate,
    responseTimeMinutes,
    completedJobsCount,
    financialHealthScore: Math.round(clamp01(blended) * 1000),
  };
}

/** Number of distinct professional archetypes; also the specialty cycle length. */
export const SPECIALTY_COUNT = SPECIALTIES.length;

/** The specialty a given simulated index belongs to — see `buildSimulatedPerson`. */
export function specialtyIndexFor(personIndex: number): number {
  return ((personIndex % SPECIALTY_COUNT) + SPECIALTY_COUNT) % SPECIALTY_COUNT;
}

export function specialtyKeyFor(personIndex: number): string {
  return SPECIALTIES[specialtyIndexFor(personIndex)].key;
}

/**
 * Recovers a simulated user's generation index from their e-mail
 * (`sim.<slug>.<n>@simulado.vibematch.dev`). Returns null for anything that
 * isn't a simulated address, which is what keeps the behavioural bots from
 * ever acting on behalf of a real account.
 */
export function parseSimulatedIndex(email: string): number | null {
  const match = new RegExp(`^sim\\.[a-z0-9-]+\\.(\\d+)@${SIMULATED_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`).exec(email);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

/**
 * Stable 0–1 value derived from arbitrary strings (FNV-1a). Used wherever a
 * bot has to make a coin-flip decision — a given pair of users must always
 * resolve the same way, so the simulation is reproducible and can't be
 * accused of being re-rolled until it looked good.
 */
export function deterministicUnitFor(...parts: string[]): number {
  const input = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 4294967296;
}

/** Builds `count` people starting at `startIndex` (so repeat calls extend rather than collide). */
export function buildSimulatedPopulation(
  count: number,
  startIndex: number,
  options: SimulationOptions = {},
): SimulatedPerson[] {
  const people: SimulatedPerson[] = [];
  for (let i = 0; i < count; i++) {
    people.push(buildSimulatedPerson(startIndex + i, options));
  }
  return people;
}

// ---------------------------------------------------------------------------
// Persistence — shared by the admin route and the standalone script
// ---------------------------------------------------------------------------

let cachedPasswordHash: string | undefined;

/**
 * bcrypt at cost 12 takes ~250 ms; hashing once per process (and lazily, so
 * merely importing this module never costs anything at Nest boot) keeps a
 * 200-user request from spending a full minute in the KDF.
 */
export function simulatedPasswordHash(): string {
  return (cachedPasswordHash ??= bcrypt.hashSync(SIMULATED_USER_PASSWORD, 12));
}

/**
 * Writes one simulated person. Upserts on the reserved e-mail so re-running
 * the generator over the same index range refreshes those rows instead of
 * failing on the unique constraint.
 */
export async function persistSimulatedPerson(prisma: PrismaClient, person: SimulatedPerson): Promise<string> {
  const passwordHash = simulatedPasswordHash();

  const user = await prisma.user.upsert({
    where: { email: person.email },
    update: {
      role: person.role,
      country: person.country,
      createdAt: person.createdAt,
    },
    create: {
      email: person.email,
      passwordHash,
      role: person.role,
      country: person.country,
      // Simulated accounts are pre-verified: an unverified account can't be
      // used to exercise the flows this population exists to demo.
      emailVerified: true,
      emailVerifiedAt: person.createdAt,
      createdAt: person.createdAt,
    },
  });

  const profileData = {
    name: person.name,
    bio: person.bio,
    skills: person.skills,
    latitude: person.latitude,
    longitude: person.longitude,
    averageRating: person.averageRating,
    b2bNetworking: person.b2bNetworking,
    hourlyRate: person.hourlyRate,
    rateCurrency: person.rateCurrency,
  };

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: profileData,
    create: { userId: user.id, ...profileData },
  });

  await prisma.providerScore.upsert({
    where: { providerId: user.id },
    update: person.score,
    create: { providerId: user.id, ...person.score },
  });

  const tier = person.proProvider ? SubscriptionTier.PRO_PROVIDER : SubscriptionTier.FREE;
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: { tier, currency: person.rateCurrency },
    create: {
      userId: user.id,
      tier,
      status: SubscriptionStatus.ACTIVE,
      currency: person.rateCurrency,
    },
  });

  return user.id;
}

/** Counts the accounts currently living on the reserved simulation domain. */
export function countSimulatedUsers(prisma: PrismaClient): Promise<number> {
  return prisma.user.count({ where: { email: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` } } });
}

export interface PurgeCounts {
  users: number;
  maintenanceAgreements: number;
  escrowProjects: number;
  chatMessages: number;
  matches: number;
  discoveryPosts: number;
}

/**
 * Purges every simulated account and everything the behavioural bots created
 * on its behalf. Scoped throughout by the reserved domain suffix, which is the
 * entire reason that domain exists — none of these deletes can reach a real
 * signup's data.
 *
 * Order matters, and not only for tidiness. `users` cascades to profiles,
 * scores, subscriptions, swipes, wallet transactions and matches, but three
 * relations to `User` are *restrict* (no `onDelete: Cascade` in the schema):
 * `EscrowProject.client/provider`, `ChatMessage.sender` and
 * `MaintenanceAgreement.client/provider`. Leave any of those behind and the
 * final user delete fails on a foreign key — which is exactly what a demo
 * cleanup must never do. They are removed explicitly, deepest first.
 */
export async function purgeSimulatedUsers(prisma: PrismaClient): Promise<PurgeCounts> {
  const simulated = await prisma.user.findMany({
    where: { email: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ids = simulated.map((u) => u.id);

  if (ids.length === 0) {
    return {
      users: 0,
      maintenanceAgreements: 0,
      escrowProjects: 0,
      chatMessages: 0,
      matches: 0,
      discoveryPosts: 0,
    };
  }

  const partyFilter = { OR: [{ clientId: { in: ids } }, { providerId: { in: ids } }] };
  const matchFilter = { OR: [{ userOneId: { in: ids } }, { userTwoId: { in: ids } }] };

  // Maintenance agreements can be created as a side effect of completing a
  // project (MaintenanceService.activateIfEligible), so a demo journey leaves
  // them behind. Cascades to its tickets.
  const maintenanceAgreements = await prisma.maintenanceAgreement.deleteMany({ where: partyFilter });

  // Cascades milestones, kanban tasks and BNPL installments; wallet
  // transactions keep their row and have relatedEscrowId set to null.
  const escrowProjects = await prisma.escrowProject.deleteMany({ where: partyFilter });

  const chatMessages = await prisma.chatMessage.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { match: matchFilter }] },
  });

  const matches = await prisma.match.deleteMany({ where: matchFilter });

  // Cascades post tags.
  const discoveryPosts = await prisma.discoveryPost.deleteMany({ where: { userId: { in: ids } } });

  const users = await prisma.user.deleteMany({ where: { id: { in: ids } } });

  return {
    users: users.count,
    maintenanceAgreements: maintenanceAgreements.count,
    escrowProjects: escrowProjects.count,
    chatMessages: chatMessages.count,
    matches: matches.count,
    discoveryPosts: discoveryPosts.count,
  };
}
