import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateSimulatedUsersDto } from './dto/create-simulated-users.dto';
import {
  MAX_SIMULATED_USERS,
  SIMULATED_EMAIL_DOMAIN,
  SIMULATED_USER_PASSWORD,
  SimulatedPerson,
  buildSimulatedPopulation,
  countSimulatedUsers,
  persistSimulatedPerson,
  purgeSimulatedUsers,
} from './simulation.core';

export interface SimulationSummaryPerson {
  userId: string;
  email: string;
  name: string;
  role: Role;
  specialty: string;
  city: string;
  skills: string[];
  hourlyRate: number;
  rateCurrency: string;
  averageRating: number;
  financialHealthScore: number;
  b2bNetworking: boolean;
}

/**
 * Populates the marketplace with clearly-labelled simulated users so the swipe
 * decks, the LOCAL radius search and the B2B feed have something to show
 * before real supply exists.
 *
 * All generation and persistence lives in `simulation.core.ts`, which
 * `prisma/seed-simulation.ts` also calls — the HTTP route and the console
 * script are two entry points onto exactly one implementation.
 */
@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSimulatedUsers(dto: CreateSimulatedUsersDto) {
    const existing = await countSimulatedUsers(this.prisma);

    // Runaway guard. The route is admin-only, but "admin held the button down"
    // is a realistic way to end up with 40k rows that then have to be deleted
    // from a production database under time pressure.
    if (existing + dto.count > MAX_SIMULATED_USERS) {
      throw new BadRequestException(
        `Limite de população simulada atingido: já existem ${existing} usuários simulados e o teto é ` +
          `${MAX_SIMULATED_USERS}. Solicite no máximo ${Math.max(0, MAX_SIMULATED_USERS - existing)} ou ` +
          `execute DELETE /admin/simulation/users antes.`,
      );
    }

    // Starting where the existing population ends means a second identical
    // request extends the roster instead of colliding on the deterministic
    // e-mails — and a purge-then-recreate reproduces the same people exactly.
    const people = buildSimulatedPopulation(dto.count, existing, {
      country: dto.country,
      role: dto.role,
    });

    const created: SimulationSummaryPerson[] = [];
    for (const person of people) {
      const userId = await persistSimulatedPerson(this.prisma, person);
      created.push(this.toSummary(userId, person));
    }

    this.logger.log(
      `Created ${created.length} simulated users (indices ${existing}..${existing + dto.count - 1}) on @${SIMULATED_EMAIL_DOMAIN}`,
    );

    return {
      created: created.length,
      totalSimulated: existing + created.length,
      startIndex: existing,
      loginPassword: SIMULATED_USER_PASSWORD,
      emailDomain: SIMULATED_EMAIL_DOMAIN,
      users: created,
    };
  }

  /**
   * Removes every account on the reserved simulation domain, plus everything
   * the behavioural bots created on their behalf — matches, chat messages,
   * feed posts, escrow projects and any maintenance agreement a completed
   * demo journey spawned.
   */
  async deleteSimulatedUsers() {
    const deleted = await purgeSimulatedUsers(this.prisma);
    this.logger.log(
      `Purged simulated data from @${SIMULATED_EMAIL_DOMAIN}: ` +
        `${deleted.users} users, ${deleted.matches} matches, ${deleted.chatMessages} messages, ` +
        `${deleted.discoveryPosts} posts, ${deleted.escrowProjects} escrow projects, ` +
        `${deleted.maintenanceAgreements} maintenance agreements.`,
    );
    return { deleted, emailDomain: SIMULATED_EMAIL_DOMAIN };
  }

  async getStatus() {
    const simulatedWhere = { email: { endsWith: `@${SIMULATED_EMAIL_DOMAIN}` } };

    // groupBy is deliberately outside $transaction: Prisma's array-form
    // transaction erases the per-call result types, and the `_count` shape
    // stops narrowing. These are four independent reads of a counter — a
    // snapshot isolation guarantee buys nothing here.
    const [simulatedUsers, totalUsers, byCountryRows, byRoleRows] = await Promise.all([
      this.prisma.user.count({ where: simulatedWhere }),
      this.prisma.user.count(),
      this.prisma.user.groupBy({ by: ['country'], where: simulatedWhere, _count: true, orderBy: { country: 'asc' } }),
      this.prisma.user.groupBy({ by: ['role'], where: simulatedWhere, _count: true, orderBy: { role: 'asc' } }),
    ]);

    return {
      simulatedUsers,
      realUsers: totalUsers - simulatedUsers,
      byCountry: Object.fromEntries(byCountryRows.map((row) => [row.country, row._count])),
      byRole: Object.fromEntries(byRoleRows.map((row) => [row.role, row._count])),
      emailDomain: SIMULATED_EMAIL_DOMAIN,
      maxSimulatedUsers: MAX_SIMULATED_USERS,
    };
  }

  private toSummary(userId: string, person: SimulatedPerson): SimulationSummaryPerson {
    return {
      userId,
      email: person.email,
      name: person.name,
      role: person.role,
      specialty: person.specialty,
      city: person.city,
      skills: person.skills,
      hourlyRate: person.hourlyRate,
      rateCurrency: person.rateCurrency,
      averageRating: person.averageRating,
      financialHealthScore: person.score.financialHealthScore,
      b2bNetworking: person.b2bNetworking,
    };
  }
}
