import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { SetMentorDto } from './dto/set-mentor.dto';

const USER_LIST_SELECT = {
  id: true,
  email: true,
  role: true,
  accountStatus: true,
  identityVerified: true,
  emailVerified: true,
  walletBalance: true,
  country: true,
  isBot: true,
  deletedAt: true,
  createdAt: true,
  profile: { select: { name: true, averageRating: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { profile: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, limit: query.limit ?? 20, offset: query.offset ?? 0 };
  }

  /** Fuller detail for the admin review pane — includes counts an admin needs to judge a ban/approve decision. */
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_LIST_SELECT,
        stripeConnectPayoutsEnabled: true,
        score: true,
        _count: {
          select: {
            escrowAsClient: true,
            escrowAsProvider: true,
            fraudCheckLogs: true,
            walletTransactions: true,
            discoveryPosts: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateAccountStatus(userId: string, accountStatus: AccountStatus) {
    await this.ensureExists(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus },
      select: USER_LIST_SELECT,
    });
  }

  async setIdentityVerified(userId: string, identityVerified: boolean) {
    await this.ensureExists(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { identityVerified },
      select: USER_LIST_SELECT,
    });
  }

  /**
   * Grants/revokes the curated mentor flag on the user's profile — the only
   * writer of `UserProfile.isMentor`, so mentor status can never be
   * self-assigned.
   *
   * `headline`/`topics` are written only when supplied, so a bare
   * `{ isMentor: true }` re-grant doesn't wipe copy an admin wrote earlier.
   * Revoking keeps them for the same reason: re-promoting a mentor shouldn't
   * cost their headline.
   */
  async setMentor(userId: string, dto: SetMentorDto) {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('User profile not found');

    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        isMentor: dto.isMentor,
        ...(dto.headline !== undefined ? { mentorHeadline: dto.headline } : {}),
        ...(dto.topics !== undefined ? { mentorTopics: dto.topics } : {}),
      },
      select: {
        userId: true,
        name: true,
        isMentor: true,
        mentorHeadline: true,
        mentorTopics: true,
      },
    });
  }

  private async ensureExists(userId: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw new NotFoundException('User not found');
  }
}
