import { SPECIALTY_COUNT, deterministicUnitFor, specialtyIndexFor } from './simulation.core';

/**
 * Written material the behavioural bots speak with — chat replies and feed
 * posts, in Portuguese, in the voice of each professional archetype.
 *
 * The specialty order here matches `SPECIALTIES` in `simulation.core.ts`
 * index for index; `assertContentAligned()` fails loudly at module load if the
 * two ever drift, because a silent off-by-one would put a plumber's answers in
 * a designer's mouth and that is exactly the kind of tell that makes a demo
 * look fake.
 *
 * Nothing here is a mad-lib: openers, bodies and closers are separate lists
 * so sixty bots don't repeat the same three sentences, but each body is real,
 * specific advice from that trade — the part a reader actually judges.
 */

/** How a professional opens a reply. Deliberately varied in register and length. */
const OPENERS = [
  'Oi! Obrigado pela mensagem.',
  'Bom dia! Vi sua mensagem agora.',
  'Olá, tudo bem? Recebi aqui.',
  'Opa, boa! Consigo te ajudar sim.',
  'Oi, obrigado por chamar.',
  'Fala! Acabei de ler.',
  'Olá! Já dei uma olhada no que você descreveu.',
  'Oi, tudo certo? Vamos lá.',
  'Boa tarde! Obrigado pelo contato.',
  'Oi! Esse tipo de projeto é bem o meu dia a dia.',
  'Olá! Legal, é um problema que eu vejo bastante.',
  'Oi, obrigado — respondendo rápido porque isso costuma ser urgente.',
];

/** How a reply lands: a concrete next step, never a vague "vamos conversar". */
const CLOSERS = [
  'Consegue me passar mais um detalhe para eu fechar o orçamento?',
  'Se quiser, faço uma call de 15 minutos ainda hoje e já te dou um número.',
  'Me diz o prazo que você tem em mente e eu monto a proposta.',
  'Posso te mandar um escopo por escrito até amanhã de manhã.',
  'Qual a sua urgência? Isso muda bastante a forma de atacar.',
  'Me manda o que você já tem e eu te digo o que dá para aproveitar.',
  'Fecho por etapa, então dá para começar pequeno e ver o resultado antes de ampliar.',
  'Se fizer sentido, começo já na semana que vem.',
  'Te passo uma faixa de valor assim que entender o tamanho.',
  'Prefere que eu vá até aí ou resolvemos remoto mesmo?',
];

/**
 * Three replies per specialty, ordered by conversation depth: the first is
 * qualification, the second is method, the third is scope and price.
 */
const SPECIALTY_REPLIES: string[][] = [
  // 0 — Automação com IA
  [
    'Antes de propor ferramenta, preciso saber qual processo consome mais hora de gente cara hoje. É atendimento, orçamento, cobrança ou entrada de pedido?',
    'Meu método é sempre o mesmo: mapeio o fluxo atual, meço quanto tempo ele custa por semana e automatizo um pedaço só. Se sobreviver trinta dias sem manutenção, aí a gente amplia.',
    'Para um fluxo desse tamanho eu trabalho em três semanas: uma de mapeamento, uma de construção e uma de ajuste com o time usando de verdade. Deixo documentado para vocês não dependerem de mim depois.',
  ],
  // 1 — Integrações de pagamento
  [
    'Duas perguntas rápidas: qual gateway vocês usam e o problema é cobrança que não acontece ou baixa que não bate no financeiro? Costuma ser bem diferente.',
    'Começo sempre auditando os eventos de webhook dos últimos trinta dias. Quase sempre aparece um número de falhas que ninguém sabia que existia, e esse número já justifica o trabalho.',
    'Entrego com validação de assinatura, retentativa idempotente e um relatório semanal de conciliação. É o pacote que faz o financeiro parar de conferir no olho.',
  ],
  // 2 — Backend e APIs
  [
    'Me conta um pouco da stack atual e onde exatamente dói: é lentidão, é bug recorrente ou é uma funcionalidade nova que ninguém consegue encaixar?',
    'Costumo entrar por um ponto pequeno e mensurável, tipo a rota mais lenta, para provar valor antes de mexer em arquitetura. Reescrita grande no primeiro mês raramente termina bem.',
    'Trabalho por sprint quinzenal com escopo fechado. No fim de cada uma você tem algo em produção, não um relatório de progresso.',
  ],
  // 3 — Edição de vídeo curto
  [
    'Você já tem material gravado ou a gente começa pela captação? E qual o volume por mês que você imagina?',
    'Sempre entrego duas versões do gancho inicial. Testar os três primeiros segundos custa dez minutos e muda o alcance do vídeo inteiro.',
    'Meu pacote padrão é doze cortes por mês a partir do seu bruto, com legenda e capa, entrega em até 48 horas por lote.',
  ],
  // 4 — Conteúdo de marca em vídeo
  [
    'Esse vídeo é para vender agora ou para posicionar a marca? Muda completamente o roteiro e o tempo de gravação.',
    'Gravo com o próprio especialista da empresa em vez de ator. Fica menos polido e converte mais, porque a pessoa sabe do que está falando.',
    'Um dia de gravação rende normalmente um institucional de noventa segundos mais oito cortes verticais. Entrego com calendário de publicação junto.',
  ],
  // 5 — UI/UX de produto
  [
    'Qual é a métrica que está incomodando: gente que entra e não ativa, ou gente que ativa e some depois de duas semanas?',
    'Antes de desenhar tela eu falo com cinco clientes reais e olho onde o fluxo quebra. Boa parte do trabalho acaba sendo cortar coisa, não adicionar.',
    'Entrego protótipo navegável testado com usuário e os componentes já pensados para o seu time construir sem reinventar cada tela.',
  ],
  // 6 — Design system e identidade
  [
    'Vocês já têm alguma biblioteca de componentes ou cada tela foi feita do zero? Isso define o tamanho do trabalho.',
    'Começo inventariando tudo que já existe e agrupando o que é a mesma coisa com nome diferente. Quase sempre dá para reduzir a mais ou menos um terço.',
    'O entregável é a biblioteca, os tokens de cor e espaçamento e um guia curto. Sem o guia, em três meses volta ao caos.',
  ],
  // 7 — Encanamento residencial
  [
    'É vazamento aparente ou conta de água subindo sem explicação? E é casa ou apartamento? Pergunto porque muda o jeito de localizar.',
    'Faço caça-vazamento antes de quebrar qualquer coisa. Já cheguei em obra onde tinham aberto três paredes e o problema estava no registro do quintal.',
    'Visita de diagnóstico é valor fixo e abato do serviço se você fechar comigo. Levo o material comum na van, então na maioria dos casos resolvo no mesmo dia.',
  ],
  // 8 — Instalação de pisos
  [
    'Quantos metros quadrados e qual tipo de piso você está pensando? E o contrapiso atual está nivelado ou nunca foi verificado?',
    'A preparação do contrapiso é onde quase todo problema de piso começa. Se pular essa etapa, em seis meses aparece estalo e desnível, e aí é retrabalho.',
    'Trabalho com orçamento fechado por metro, material e mão de obra separados, e volto para uma revisão de ajuste depois de trinta dias.',
  ],
  // 9 — Manutenção predial
  [
    'É um problema pontual ou vocês estão querendo montar um plano de manutenção mensal? Atendo os dois, mas o segundo sai bem mais barato no ano.',
    'Faço uma ronda inicial listando o que está prestes a quebrar, priorizado pelo custo de deixar quebrar. É mais barato do que chamar emergência três vezes por trimestre.',
    'O plano mensal inclui duas visitas, ordem de serviço registrada e relatório com foto. Quem aprova o gasto quase nunca é quem viu o problema.',
  ],
  // 10 — SEO local para serviços
  [
    'Você já tem perfil no Google? E quantas avaliações tem hoje? Esses dois números me dizem quase tudo sobre o ponto de partida.',
    'Começo pelo básico chato: nome, endereço e telefone idênticos em todo lugar, categoria certa e vinte fotos reais. Só isso costuma mexer o ponteiro em um mês.',
    'Meu indicador não é posição no ranking, é quantos pedidos de orçamento entraram no mês. Coloco um número de telefone separado para conseguir medir isso de verdade.',
  ],
  // 11 — Controladoria e BPO financeiro
  [
    'Vocês fecham o mês em quantos dias hoje? E existe projeção de caixa ou o controle é o saldo do banco?',
    'A primeira coisa que faço é separar o que é caixa do que é resultado. Empresa lucrativa que vive apertada tem problema de prazo, não de margem.',
    'Monto plano de contas, rotina de conciliação e a projeção rolante de treze semanas, treino alguém de vocês e depois saio de cena.',
  ],
  // 12 — Auditoria e compliance financeiro
  [
    'A auditoria é por exigência de alguém de fora, tipo investidor ou sócio novo, ou é uma suspeita interna? Muda bastante a profundidade.',
    'Levanto primeiro o que não está documentado e ordeno por gravidade. Não adianta entregar cinquenta apontamentos se três deles é que podem derrubar o negócio.',
    'O relatório sai em três semanas, com prazo e responsável para cada ponto. Faço também a reunião de devolutiva com quem vai executar.',
  ],
  // 13 — Parcerias e desenvolvimento B2B
  [
    'Você quer um canal de indicação estruturado ou abrir portas em contas específicas? São trabalhos bem diferentes.',
    'Trabalho com lista curta de contas nomeadas, não com disparo em massa. Devolvo relatório do que cada conversa revelou, mesmo quando não fecha.',
    'Meu contrato normalmente tem fixo baixo e variável por contrato assinado. Prefiro ganhar quando funciona.',
  ],
  // 14 — Growth para SaaS
  [
    'Quantos por cento de quem testa vira cliente pagante hoje? Se você não tiver o número na ponta da língua, esse já é o primeiro trabalho.',
    'Antes de investir em mais tráfego eu olho quantos dos que entraram chegaram ao momento em que o produto faz sentido. Quase sempre é aí que está o vazamento.',
    'Rodo um experimento por vez, com métrica combinada antes e prazo de duas semanas. Documento inclusive o que não funcionou.',
  ],
];

interface SeedFeedPost {
  title: string;
  contentText: string;
  tags: string[];
}

/** Two genuine feed posts per specialty — short, specific, and worth reading. */
const SPECIALTY_POSTS: SeedFeedPost[][] = [
  [
    {
      title: 'A automação que morreu porque só uma pessoa sabia operar',
      contentText:
        'Cliente me chamou para consertar um fluxo que parou havia duas semanas. Estava tudo certo tecnicamente: parou porque a única pessoa que sabia mexer saiu de férias e ninguém sabia por onde o processo passava. Refiz com log, alerta de erro e um manual de uma página. Automação sem segundo responsável não é ganho de produtividade, é troca de gargalo.',
      tags: ['AI_AUTOMATION', 'MAKE'],
    },
    {
      title: 'Como escolho o processo que vale automatizar',
      contentText:
        'Três critérios, e precisam aparecer juntos: consome hora de gente qualificada, repete pelo menos toda semana e tem regra estável. Falhando um dos três, a automação vira dívida técnica com cara de inovação. Automatizar dez minutos do estagiário economiza dez minutos do estagiário — automatizar duas horas do comercial devolve receita.',
      tags: ['AI_AUTOMATION', 'SaaS'],
    },
  ],
  [
    {
      title: 'Achei R$ 40 mil parados num webhook que ninguém olhava',
      contentText:
        'Auditoria de rotina numa operação de assinatura: 312 eventos de pagamento nunca chegaram na aplicação nos últimos noventa dias. Cada um é um cliente que pagou e podia não ter acesso. O gateway tinha tentado entregar, a aplicação estava reiniciando por deploy, e ninguém tinha alerta para silêncio. Se você não consegue listar os webhooks que falharam no mês, você tem esse problema.',
      tags: ['STRIPE_WEBHOOK', 'PAYMENTS'],
    },
    {
      title: 'Retentativa de cartão recusado: o calendário que funciona',
      contentText:
        'Não retente na hora. A recusa geralmente é saldo, e insistir no mesmo dia só queima a tentativa. O que funciona aqui: três, cinco e sete dias, sempre em horário comercial, com aviso ao cliente entre as tentativas. Depois da terceira, suspenda o acesso mas não apague nada por trinta dias. Boa parte desses clientes volta.',
      tags: ['PAYMENTS', 'BACKEND'],
    },
  ],
  [
    {
      title: 'A consulta que varria a tabela inteira toda vez',
      contentText:
        'Rota de listagem levando 8 segundos em produção. O time achava que era volume de dados. Era um filtro sem índice numa tabela de 2 milhões de linhas, rodando a cada carregamento de tela. Índice criado, 8 segundos viraram 40 milissegundos. Antes de discutir arquitetura, olhe o plano de execução das três consultas mais chamadas.',
      tags: ['BACKEND', 'SaaS'],
    },
    {
      title: 'Erro de API que não diz nada é bug que volta',
      contentText:
        'Se a sua API responde "erro interno" para tudo, você está transferindo o custo de diagnóstico para quem consome. Mensagem útil não é vazamento de segurança: dizer qual campo falhou e por quê economiza uma ida e volta de suporte por dia. Reservo umas duas horas por sprint só para isso e não me arrependo.',
      tags: ['BACKEND', 'SaaS'],
    },
  ],
  [
    {
      title: 'Testei 6 ganchos no mesmo vídeo. O resultado não foi sutil',
      contentText:
        'Mesmo conteúdo, mesma edição, só a abertura mudando. Do pior para o melhor gancho, a retenção aos 3 segundos foi de 31% para 68%. É o mesmo vídeo. Refazer a abertura custa dez minutos de edição e é a alavanca mais barata que existe em vídeo curto.',
      tags: ['VIDEO_EDITING', 'SHORT_FORM'],
    },
    {
      title: 'Corte rápido não é ritmo',
      contentText:
        'Vejo muito editor cortando a cada meio segundo achando que isso prende. Prende por dois segundos e cansa no quinto. Ritmo é variar: um trecho longo respirando, um corte seco na virada de ideia. Quem edita conteúdo falado precisa cortar pela frase, não pelo cronômetro.',
      tags: ['VIDEO_EDITING', 'DESIGN'],
    },
  ],
  [
    {
      title: 'Gravei com o dono da empresa em vez de contratar ator',
      contentText:
        'Ficou menos polido e converteu quase o dobro. A pessoa gagueja um pouco, mas responde objeção de verdade, com número e caso real. Quem assiste percebe a diferença entre alguém explicando o que faz e alguém decorando texto. Vídeo institucional caro e vazio é dinheiro parado.',
      tags: ['VIDEO_EDITING', 'STARTUPS'],
    },
    {
      title: 'Um dia de gravação, oito semanas de conteúdo',
      contentText:
        'Roteiro dividido em blocos curtos, tudo gravado num turno, e a edição distribui ao longo de dois meses. Custa uma diária e resolve o calendário inteiro. O erro comum é gravar sem roteiro de blocos: aí sobra material bonito que não vira publicação nenhuma.',
      tags: ['SHORT_FORM', 'VIDEO_EDITING'],
    },
  ],
  [
    {
      title: 'Removi metade dos campos e a ativação subiu',
      contentText:
        'O cadastro pedia quatorze informações "para personalizar a experiência". Cortamos para cinco e movemos o resto para depois do primeiro valor entregue. Conclusão de cadastro subiu 22 pontos. Ninguém preenche formulário para ter experiência personalizada; preenche para resolver um problema.',
      tags: ['UI_UX', 'SaaS'],
    },
    {
      title: 'Estado vazio é a tela mais importante do produto',
      contentText:
        'É a primeira coisa que todo usuário novo vê, e normalmente é a última a ser desenhada. "Nenhum item encontrado" desperdiça o momento em que a pessoa está mais disposta a aprender. Use aquele espaço para mostrar o que ela deveria fazer e por quê.',
      tags: ['UI_UX', 'DESIGN'],
    },
  ],
  [
    {
      title: 'Encontrei 19 tons de azul no mesmo produto',
      contentText:
        'Auditoria de interface numa empresa com três anos de produto: 19 azuis, 11 tamanhos de fonte e 4 estilos de botão primário. Ninguém fez de propósito, foi acúmulo. Reduzimos para 4 azuis e 6 tamanhos, e o time de front parou de perguntar qual usar em cada tela.',
      tags: ['DESIGN', 'UI_UX'],
    },
    {
      title: 'Sua apresentação comercial e seu app parecem duas empresas',
      contentText:
        'Acontece em quase toda empresa B2B que cresceu rápido: marketing evoluiu a marca, produto ficou no visual de três anos atrás. O cliente percebe, e isso mexe na percepção de preço. Alinhar as duas coisas é trabalho chato de uma semana com efeito comercial imediato.',
      tags: ['DESIGN', 'STARTUPS'],
    },
  ],
  [
    {
      title: 'Abriram três paredes atrás de um vazamento no registro do quintal',
      contentText:
        'Cheguei na obra com o serviço já começado errado. Vazamento aparecia no teto do vizinho de baixo, e a suspeita era da coluna. Meia hora de teste de pressão por trecho mostrou que era um registro externo. Antes de quebrar qualquer coisa, isole o trecho e teste. Sai muito mais barato.',
      tags: ['PLUMBING', 'LOCAL_SERVICE'],
    },
    {
      title: 'Conta de água que sobe sem torneira pingando',
      contentText:
        'Feche tudo dentro de casa e olhe o hidrômetro por quinze minutos. Se ele andar, existe vazamento não aparente, quase sempre em tubulação embutida ou na caixa d\'água. Dá para localizar sem quebradeira com geofone. Detectar cedo costuma custar um décimo do conserto tardio.',
      tags: ['PLUMBING', 'MAINTENANCE'],
    },
  ],
  [
    {
      title: 'O estalo do piso começou no contrapiso, não no material',
      contentText:
        'Recebo muito chamado de piso laminado estalando seis meses depois da instalação. Quase nunca é o produto. É contrapiso fora de nível ou manta aplicada às pressas. Uma hora de nivelamento a mais na instalação evita a semana de retrabalho depois.',
      tags: ['FLOOR_INSTALLATION', 'MAINTENANCE'],
    },
    {
      title: '300 m² num fim de semana para a loja abrir na segunda',
      contentText:
        'Dá para fazer, mas depende de três coisas: material conferido e no local na sexta, equipe dimensionada de verdade e contrapiso já preparado antes. O que estoura prazo em obra comercial quase nunca é a instalação, é material chegando pela metade.',
      tags: ['FLOOR_INSTALLATION', 'LOCAL_SERVICE'],
    },
  ],
  [
    {
      title: 'Manutenção preventiva custa um terço da emergência',
      contentText:
        'Levantei um ano de chamados de um prédio comercial: 70% das emergências tinham sinal visível semanas antes. Infiltração começa com mancha, quadro elétrico esquenta antes de desarmar. Ronda quinzenal com lista priorizada resolveu a maior parte antes de virar urgência.',
      tags: ['MAINTENANCE', 'LOCAL_SERVICE'],
    },
    {
      title: 'Relatório com foto muda a conversa com o síndico',
      contentText:
        'Quem aprova o gasto quase nunca é quem viu o problema. Desde que passei a entregar antes e depois com foto e data, parei de discutir orçamento e passei a discutir prioridade. É o mesmo serviço, com evidência.',
      tags: ['MAINTENANCE', 'LOCAL_SERVICE'],
    },
  ],
  [
    {
      title: 'Perfil duplicado no Google estava dividindo as avaliações ao meio',
      contentText:
        'Cliente reclamando que sumiu da busca. Existiam dois cadastros da mesma empresa criados com dois anos de diferença, cada um com metade das avaliações, competindo entre si. Unificar levou três semanas de burocracia e devolveu a primeira página. Vale checar o seu hoje.',
      tags: ['LOCAL_SEO', 'LOCAL_SERVICE'],
    },
    {
      title: 'Falar de preço no site afasta curioso, não cliente',
      contentText:
        'Coloquei faixa de preço real nas páginas de serviço de um cliente. O número de contatos caiu 30% e os fechamentos subiram 40%. Quem some é quem nunca ia contratar naquele patamar. Preço é filtro, e filtro economiza o tempo do seu comercial.',
      tags: ['LOCAL_SEO', 'B2B_NETWORKING'],
    },
  ],
  [
    {
      title: 'O maior cliente dele era o menos rentável',
      contentText:
        'Rateei custo por contrato numa empresa de serviço. O cliente que respondia por 28% do faturamento dava margem negativa depois de contar as horas de atendimento fora do escopo. Renegociaram, o cliente aceitou, e o resultado do ano mudou sem nenhuma venda nova.',
      tags: ['CONTROLLER', 'FINANCIAL_AUDIT'],
    },
    {
      title: 'Empresa lucrativa que vive apertada tem problema de prazo',
      contentText:
        'Some os dias de estoque, mais os dias que o cliente demora para pagar, menos o prazo do fornecedor. Esse é o número de dias que você financia do próprio bolso. Crescer aumenta esse buraco. Por isso empresa que cresce 30% às vezes fica sem caixa vendendo mais e melhor.',
      tags: ['CONTROLLER', 'PAYMENTS'],
    },
  ],
  [
    {
      title: 'Diferença de conciliação de seis dígitos que ninguém suspeitava',
      contentText:
        'Marketplace com três anos de operação, conciliando por amostragem. Comparando venda registrada com repasse recebido, mês a mês, apareceu uma diferença acumulada que ninguém tinha percebido porque cada mês isolado parecia ruído. Concilie sempre, e some o resíduo ao longo do tempo.',
      tags: ['FINANCIAL_AUDIT', 'PAYMENTS'],
    },
    {
      title: 'Alçada de aprovação não precisa travar a empresa',
      contentText:
        'Controle interno vira burocracia quando é desenhado por quem não opera. Três faixas de valor, aprovador nomeado em cada uma e exceção documentada resolvem 90% do risco sem criar fila. O que trava não é o controle, é o controle sem alçada clara.',
      tags: ['FINANCIAL_AUDIT', 'CONTROLLER'],
    },
  ],
  [
    {
      title: 'Parceria sem regra escrita é almoço com aperto de mão',
      contentText:
        'Quem indica, o que ganha, como se mede e em quanto tempo paga. Sem esses quatro pontos por escrito, a parceria dura até a primeira indicação boa, quando aparece a dúvida sobre quem trouxe o cliente. Uma página resolve e evita perder o parceiro e a conta.',
      tags: ['B2B_NETWORKING', 'STARTUPS'],
    },
    {
      title: 'Vender para empresa grande é um jogo diferente',
      contentText:
        'Prazo longo, quatro ou cinco pessoas decidindo e jurídico no fim. Quem trata como venda de serviço para PME perde no meio do caminho. Prepare material para quem não vai estar na reunião: o seu contato precisa conseguir defender a proposta sem você na sala.',
      tags: ['B2B_NETWORKING', 'SaaS'],
    },
  ],
  [
    {
      title: 'Antes de comprar tráfego, olhe quantos chegam ao primeiro valor',
      contentText:
        'SaaS com 900 cadastros por mês e 4% virando pagante. Não era problema de aquisição: 62% nunca completavam a configuração inicial. Arrumamos o primeiro acesso e a conversão dobrou com o mesmo orçamento de mídia. Trazer mais gente para um funil furado só acelera o vazamento.',
      tags: ['SaaS', 'STARTUPS'],
    },
    {
      title: 'Um experimento por vez, métrica combinada antes',
      contentText:
        'Time rodando cinco testes ao mesmo tempo não sabe o que funcionou. Combinei uma hipótese por quinzena, indicador definido antes de começar e registro do resultado mesmo quando dá errado. Em seis meses viramos um acervo de aprendizado que vale mais que qualquer caso de sucesso isolado.',
      tags: ['SaaS', 'B2B_NETWORKING'],
    },
  ],
];

/**
 * Guards the index alignment between the specialty list and the material
 * written for it. A mismatch is a content bug that no type-checker catches.
 */
function assertContentAligned(): void {
  if (SPECIALTY_REPLIES.length !== SPECIALTY_COUNT || SPECIALTY_POSTS.length !== SPECIALTY_COUNT) {
    throw new Error(
      `simulation-content is out of sync with simulation.core: ${SPECIALTY_COUNT} specialties, ` +
        `${SPECIALTY_REPLIES.length} reply sets, ${SPECIALTY_POSTS.length} post sets.`,
    );
  }
}
assertContentAligned();

/**
 * Composes one chat reply for a simulated professional.
 *
 * `turn` is how many replies this bot has already sent in the conversation,
 * so the exchange progresses (qualify → method → scope) instead of looping.
 * Opener and closer are picked deterministically from the match and turn, so
 * two bots in two conversations don't say the same sentence.
 */
export function composeChatReply(personIndex: number, matchId: string, turn: number): string {
  const bodies = SPECIALTY_REPLIES[specialtyIndexFor(personIndex)];
  const body = bodies[Math.min(turn, bodies.length - 1)];

  const opener = OPENERS[Math.floor(deterministicUnitFor(matchId, String(personIndex), String(turn)) * OPENERS.length)];
  const closer = CLOSERS[Math.floor(deterministicUnitFor(String(personIndex), matchId, `c${turn}`) * CLOSERS.length)];

  return `${opener} ${body} ${closer}`;
}

/** Picks the feed post a given simulated author publishes on a given slot. */
export function composeFeedPost(personIndex: number, slot: number): SeedFeedPost {
  const posts = SPECIALTY_POSTS[specialtyIndexFor(personIndex)];
  return posts[slot % posts.length];
}

export type { SeedFeedPost };
