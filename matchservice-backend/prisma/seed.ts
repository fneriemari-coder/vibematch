import { PrismaClient, Currency, Role } from '@prisma/client';
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

  console.log(`Seeded ${CREATORS.length} creators and ${POSTS.length} Discovery Feed posts across 7 days.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
