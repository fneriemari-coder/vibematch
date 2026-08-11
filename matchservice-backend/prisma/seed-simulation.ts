import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_SIMULATION_COUNT,
  MAX_SIMULATED_USERS,
  SIMULATED_EMAIL_DOMAIN,
  SIMULATED_USER_PASSWORD,
  SimulatedCountry,
  SimulatedRole,
  buildSimulatedPopulation,
  countSimulatedUsers,
  persistSimulatedPerson,
} from '../src/modules/admin/simulation.core';

/**
 * Standalone population script — the same generator and the same Prisma
 * writes as POST /admin/simulation/users, callable from a platform console
 * (Railway/Render shell) with no HTTP request and no admin token:
 *
 *   node dist-seed/seed-simulation.js        # 60 users (default)
 *   node dist-seed/seed-simulation.js 120    # 120 users
 *   node dist-seed/seed-simulation.js 40 US PROVIDER
 *
 * Everything it writes lives on `@simulado.vibematch.dev` and is removable
 * with DELETE /admin/simulation/users.
 */

const prisma = new PrismaClient();

interface Args {
  count: number;
  country?: SimulatedCountry;
  role?: SimulatedRole;
}

function parseArgs(argv: string[]): Args {
  const [rawCount, rawCountry, rawRole] = argv;

  const count = rawCount === undefined ? DEFAULT_SIMULATION_COUNT : Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error(`Contagem inválida: "${rawCount}". Informe um inteiro entre 1 e 200.`);
  }

  let country: SimulatedCountry | undefined;
  if (rawCountry !== undefined) {
    if (rawCountry !== 'BR' && rawCountry !== 'US') {
      throw new Error(`País inválido: "${rawCountry}". Use BR ou US.`);
    }
    country = rawCountry;
  }

  let role: SimulatedRole | undefined;
  if (rawRole !== undefined) {
    if (rawRole !== 'PROVIDER' && rawRole !== 'CLIENT' && rawRole !== 'BOTH') {
      throw new Error(`Papel inválido: "${rawRole}". Use PROVIDER, CLIENT ou BOTH.`);
    }
    role = rawRole;
  }

  return { count, country, role };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const existing = await countSimulatedUsers(prisma);
  if (existing + args.count > MAX_SIMULATED_USERS) {
    throw new Error(
      `Limite de população simulada atingido: ${existing} usuários simulados já existem e o teto é ` +
        `${MAX_SIMULATED_USERS}. Peça no máximo ${Math.max(0, MAX_SIMULATED_USERS - existing)}.`,
    );
  }

  console.log(
    `Gerando ${args.count} usuários simulados (índices ${existing}..${existing + args.count - 1}) ` +
      `em @${SIMULATED_EMAIL_DOMAIN}...`,
  );

  const people = buildSimulatedPopulation(args.count, existing, {
    country: args.country,
    role: args.role,
  });

  for (const person of people) {
    await persistSimulatedPerson(prisma, person);
  }

  const total = await countSimulatedUsers(prisma);
  const providers = people.filter((p) => p.role !== 'CLIENT').length;
  const b2b = people.filter((p) => p.b2bNetworking).length;

  console.log(`Criados: ${people.length} (${providers} aparecem no deck de serviços, ${b2b} no modo B2B).`);
  console.log(`Total de usuários simulados agora: ${total}.`);
  console.log(`Senha de todos eles: ${SIMULATED_USER_PASSWORD}`);
  console.log(`Exemplo de login: ${people[0].email}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
