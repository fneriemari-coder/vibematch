import { Controller, ForbiddenException, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly prisma: PrismaService) {}

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
