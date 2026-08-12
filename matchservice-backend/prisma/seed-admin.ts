import { Currency, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Creates (or promotes) the operator account.
 *
 * Every admin route is behind `@Roles(Role.ADMIN)` and no seed produced an
 * ADMIN user, so the operator surfaces shipped unreachable: the cover
 * generator, the lesson renderer, the Radar refresh, the dashboard and the
 * user-management screens all existed and all answered 403 to every account
 * that existed. That is the whole reason this script is here.
 *
 * Credentials come from the environment, never from the file. A password
 * committed to a repository is a password published, and this one opens the
 * account that can ban users and read the platform's finances.
 *
 *   ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='…' npm run seed:admin
 *
 * Idempotent: run it again after changing ADMIN_PASSWORD and it rotates the
 * password on the existing account rather than failing on the unique email.
 * An account that already exists under another role is promoted, so the
 * everyday account you already sign in with can become the operator one.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Operação VIBE MATCH';
  const country = process.env.ADMIN_COUNTRY?.trim() || 'BR';

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD are required.\n' +
        "  ADMIN_EMAIL=voce@dominio.com ADMIN_PASSWORD='…' npm run seed:admin",
    );
  }

  // Short passwords on the account that can ban users and read the ledger are
  // not a tradeoff worth offering.
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const currency = country === 'BR' ? Currency.BRL : Currency.USD;

  const user = await prisma.user.upsert({
    where: { email },
    // Promotion path: an existing account keeps its profile, escrow history and
    // matches, and simply gains the role.
    update: { role: Role.ADMIN, passwordHash },
    create: {
      email,
      passwordHash,
      role: Role.ADMIN,
      country,
      profile: { create: { name, bio: 'Conta de operação da plataforma.', skills: [], rateCurrency: currency } },
      subscription: { create: { currency } },
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`Admin ready: ${user.email} (${user.id}) role=${user.role}`);
  console.log('Sign in with these credentials, then call POST /admin/courses/covers and POST /admin/news/refresh.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
