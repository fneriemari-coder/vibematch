import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TranslationService } from './translation.service';
import { SendMessageDto } from './dto/send-message.dto';
import type { JwtPayload } from '../auth/jwt.strategy';

interface AuthedSocket extends Socket {
  data: { userId: string };
}

/**
 * Real-time chat over Socket.io, room-per-match. Auth is a JWT passed as
 * `auth.token` in the client handshake (not a cookie/header, since this is a
 * pure WS gateway shared by web and Flutter clients).
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
  ) {}

  handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException('Missing token');
      const payload = this.jwtService.verify<JwtPayload>(token);
      client.data.userId = payload.sub;
      this.logger.log(`Socket connected: user ${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    this.logger.log(`Socket disconnected: user ${client.data?.userId ?? 'unknown'}`);
  }

  @SubscribeMessage('joinMatch')
  async joinMatch(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { matchId: string }) {
    const match = await this.prisma.match.findUnique({ where: { id: data.matchId } });
    if (!match || ![match.userOneId, match.userTwoId].includes(client.data.userId)) {
      client.emit('error', { message: 'Not a participant in this match' });
      return;
    }
    client.join(this.roomName(data.matchId));
  }

  @SubscribeMessage('sendMessage')
  async sendMessage(@ConnectedSocket() client: AuthedSocket, @MessageBody() dto: SendMessageDto) {
    const senderId = client.data.userId;

    const match = await this.prisma.match.findUnique({
      where: { id: dto.matchId },
      include: {
        userOne: { select: { id: true, country: true } },
        userTwo: { select: { id: true, country: true } },
      },
    });
    if (!match || ![match.userOneId, match.userTwoId].includes(senderId)) {
      client.emit('error', { message: 'Not a participant in this match' });
      return;
    }

    const other = match.userOneId === senderId ? match.userTwo : match.userOne;
    const sender = match.userOneId === senderId ? match.userOne : match.userTwo;
    const sourceLang = TranslationService.languageForCountry(sender.country);
    const targetLang = TranslationService.languageForCountry(other.country);

    const translatedContent = await this.translationService.translate(
      dto.content,
      sourceLang,
      targetLang,
    );

    const message = await this.prisma.chatMessage.create({
      data: {
        matchId: dto.matchId,
        senderId,
        content: dto.content,
        translatedContent,
        sourceLang,
        targetLang,
      },
    });

    this.server.to(this.roomName(dto.matchId)).emit('newMessage', message);
    return message;
  }

  private roomName(matchId: string): string {
    return `match:${matchId}`;
  }
}
