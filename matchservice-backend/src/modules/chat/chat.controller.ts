import { Controller, ForbiddenException, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's conversations, most recently active first.
   *
   * Without this the chat room was unreachable in practice: a room could only
   * be opened once, straight off the "deu match" screen, and nothing led back
   * to it — so every conversation was lost the moment the user navigated away.
   */
  @Get('matches')
  async listMatches(@CurrentUser() user: AuthenticatedUser) {
    const matches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.ACTIVE,
        OR: [{ userOneId: user.id }, { userTwoId: user.id }],
      },
      include: {
        userOne: { select: { id: true, profile: { select: { name: true, skills: true } } } },
        userTwo: { select: { id: true, profile: { select: { name: true, skills: true } } } },
        chatMessages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return matches
      .map((match) => {
        const other = match.userOneId === user.id ? match.userTwo : match.userOne;
        const lastMessage = match.chatMessages[0] ?? null;
        return {
          matchId: match.id,
          type: match.type,
          otherUserId: other.id,
          otherUserName: other.profile?.name ?? 'Usuário',
          otherUserSkills: other.profile?.skills ?? [],
          lastMessage: lastMessage?.content ?? null,
          lastMessageAt: lastMessage?.createdAt ?? null,
          lastMessageFromMe: lastMessage ? lastMessage.senderId === user.id : null,
          createdAt: match.createdAt,
        };
      })
      // A fresh match has no messages yet and so no lastMessageAt to sort on —
      // fall back to when the match itself was created, so a new match surfaces
      // at the top instead of sinking below every older conversation.
      .sort(
        (a, b) =>
          (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime(),
      );
  }

  @Get(':matchId/messages')
  async history(@CurrentUser() user: AuthenticatedUser, @Param('matchId') matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');
    if (![match.userOneId, match.userTwoId].includes(user.id)) {
      throw new ForbiddenException('Not a participant in this match');
    }
    return this.prisma.chatMessage.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
