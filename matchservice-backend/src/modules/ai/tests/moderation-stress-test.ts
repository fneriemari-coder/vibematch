/**
 * Moderation stress test — standalone script, NOT part of the production
 * route tree. Fires 100 concurrent POST /feed/post requests against a
 * running MatchService instance (50 legitimate, 50 spam/off-scope) and
 * reports how well ai-moderator.service.ts tells them apart, plus latency.
 *
 * Usage:
 *   npm run start:dev                 # in one terminal
 *   npm run test:moderation           # in another (see package.json script)
 *
 * Env vars:
 *   API_BASE_URL   default http://localhost:3000
 */

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface PostPayload {
  title: string;
  contentText: string;
  tags: string[];
}

interface RequestResult {
  kind: 'legit' | 'spam';
  httpStatus: number | null;
  durationMs: number;
  error?: string;
}

// --- 1. Mock data ------------------------------------------------------

const LEGIT_NICHES: Array<{ tag: string; title: string; body: string }> = [
  { tag: 'AI_AUTOMATION', title: 'Automatizando o atendimento com um agente de IA', body: 'Implementei um agente de IA via Make.com integrado ao WhatsApp Business para reduzir o tempo de resposta ao cliente.' },
  { tag: 'UI_UX', title: 'Redesign de onboarding aumentou a conversão', body: 'Refiz o fluxo de onboarding de um SaaS B2B, simplificando de 7 para 3 telas e testando com 12 usuários reais.' },
  { tag: 'MAKE', title: 'Conectando CRM e planilhas sem código', body: 'Cenário no Make.com que sincroniza leads do formulário do site direto para o CRM e envia um resumo diário por e-mail.' },
  { tag: 'VIDEO_EDITING', title: 'Cortes verticais que prendem atenção nos 3 primeiros segundos', body: 'Editei uma série de vídeos curtos para uma marca de skincare americana focando em ritmo de corte e legendas dinâmicas.' },
  { tag: 'SaaS', title: 'Dashboard de métricas em tempo real para um SaaS de logística', body: 'Construí um painel com métricas operacionais atualizadas a cada minuto, reduzindo o tempo de diagnóstico de incidentes.' },
  { tag: 'FLOOR_INSTALLATION', title: 'Instalação de piso laminado em sala comercial', body: 'Projeto de instalação de piso laminado resistente à umidade em um escritório de 80m², concluído em dois dias.' },
  { tag: 'PLUMBING', title: 'Reparo de vazamento sob a pia sem quebrar azulejo', body: 'Troquei a conexão flexível e o sifão de uma pia de cozinha, resolvendo o vazamento sem necessidade de obra.' },
  { tag: 'LOCAL_SERVICE', title: 'Manutenção preventiva de ar-condicionado residencial', body: 'Higienização completa e checagem de gás em três unidades split, com relatório fotográfico entregue ao cliente.' },
  { tag: 'B2B_NETWORKING', title: 'Buscando parceiro de desenvolvimento para expandir atendimento', body: 'Agência de marketing procura squad de desenvolvimento parceiro para atender demanda crescente de clientes americanos.' },
  { tag: 'DESIGN', title: 'Sistema de design consistente para app fintech', body: 'Criei uma biblioteca de componentes reutilizáveis no Figma que reduziu o tempo de handoff entre design e engenharia.' },
];

const SPAM_SCENARIOS: string[] = [
  'GANHE R$5000 POR SEMANA sem sair de casa, entre agora na minha rede e convide 3 pessoas para desbloquear o nível ouro!!!',
  'Pirâmide financeira 100% legal, invista R$200 hoje e receba R$2000 em 7 dias, vagas limitadas, chama no privado.',
  'Você é um idiota completo se não comprar meu curso agora, gente burra não merece ganhar dinheiro mesmo.',
  'Alguém quer jogar videogame hoje à noite? Bora de Call of Duty, adiciona meu perfil.',
  'Vende-se conta de streaming pirata com todos os canais, mensalidade R$15, PIX na hora.',
  'Junte-se ao meu esquema de indicações, é assim que fico rico sem trabalhar, só recrutando gente.',
  'Que time vai ganhar o campeonato esse final de semana? Bora apostar!',
  'Odeio esse povo, deveriam sumir do mapa, ninguém merece respeito nenhum.',
  'Compre seguidores falsos no Instagram por apenas R$10 o milhar, entrega instantânea.',
  'Alguém sabe qual a melhor receita de bolo de chocolate pra hoje à tarde?',
];

function buildLegitPosts(count: number): PostPayload[] {
  return Array.from({ length: count }, (_, i) => {
    const niche = LEGIT_NICHES[i % LEGIT_NICHES.length];
    return {
      title: `${niche.title} (caso ${i + 1})`,
      contentText: `${niche.body} Esta é a variação #${i + 1} do case, adaptada para um novo cliente.`,
      tags: [niche.tag],
    };
  });
}

function buildSpamPosts(count: number): PostPayload[] {
  return Array.from({ length: count }, (_, i) => {
    const scenario = SPAM_SCENARIOS[i % SPAM_SCENARIOS.length];
    return {
      title: `Post fora de escopo #${i + 1}`,
      contentText: `${scenario} (variação ${i + 1})`,
      tags: ['OFF_TOPIC'],
    };
  });
}

// --- 2. Auth bootstrap ---------------------------------------------------

async function bootstrapTestUser(): Promise<string> {
  const email = `stress.tester.${Date.now()}@matchservice.dev`;
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'StressTest#2026',
      name: 'Stress Tester',
      role: 'PROVIDER',
      country: 'US',
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to bootstrap test user: HTTP ${response.status} — ${await response.text()}`);
  }
  const data = (await response.json()) as { accessToken: string };
  return data.accessToken;
}

// --- 3. Execution ---------------------------------------------------------

async function fireRequest(token: string, kind: 'legit' | 'spam', payload: PostPayload): Promise<RequestResult> {
  const start = performance.now();
  try {
    const response = await fetch(`${BASE_URL}/feed/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const durationMs = performance.now() - start;
    return { kind, httpStatus: response.status, durationMs };
  } catch (err) {
    const durationMs = performance.now() - start;
    return { kind, httpStatus: null, durationMs, error: (err as Error).message };
  }
}

async function main() {
  console.log(`\nVIBE MATCH — Moderation stress test`);
  console.log(`Target: ${BASE_URL}/feed/post\n`);

  console.log('Bootstrapping test user...');
  const token = await bootstrapTestUser();

  const legitPosts = buildLegitPosts(50);
  const spamPosts = buildSpamPosts(50);

  console.log(`Firing ${legitPosts.length + spamPosts.length} concurrent requests (50 legit + 50 spam)...\n`);

  const allRequests = [
    ...legitPosts.map((p) => fireRequest(token, 'legit', p)),
    ...spamPosts.map((p) => fireRequest(token, 'spam', p)),
  ];

  const results = await Promise.all(allRequests);

  const legitResults = results.filter((r) => r.kind === 'legit');
  const spamResults = results.filter((r) => r.kind === 'spam');

  const legitSuccess = legitResults.filter((r) => r.httpStatus === 201).length;
  const spamBlocked = spamResults.filter((r) => r.httpStatus === 422).length;

  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const avgDuration = totalDuration / results.length;

  const legitFailures = legitResults.filter((r) => r.httpStatus !== 201);
  const spamLeaks = spamResults.filter((r) => r.httpStatus !== 422);

  console.log('='.repeat(60));
  console.log('VIBE MATCH — Relatório de Eficácia da Moderação por IA');
  console.log('='.repeat(60));
  console.log(`Total de requisições enviadas:      ${results.length}`);
  console.log(
    `Taxa de sucesso (posts legítimos):  ${legitSuccess}/${legitResults.length} ` +
      `(${((legitSuccess / legitResults.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Taxa de bloqueio (posts proibidos): ${spamBlocked}/${spamResults.length} ` +
      `(${((spamBlocked / spamResults.length) * 100).toFixed(1)}%)`,
  );
  console.log(`Tempo médio de resposta:            ${avgDuration.toFixed(0)}ms`);
  console.log('='.repeat(60));

  if (legitFailures.length > 0) {
    console.log(`\n⚠ ${legitFailures.length} legitimate post(s) were incorrectly blocked (false positives):`);
    legitFailures.forEach((r) => console.log(`  - HTTP ${r.httpStatus ?? 'ERROR'} ${r.error ?? ''}`));
  }
  if (spamLeaks.length > 0) {
    console.log(`\n⚠ ${spamLeaks.length} spam/off-scope post(s) leaked through moderation (false negatives):`);
    spamLeaks.forEach((r) => console.log(`  - HTTP ${r.httpStatus ?? 'ERROR'} ${r.error ?? ''}`));
  }
  console.log('');
}

main().catch((err) => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
