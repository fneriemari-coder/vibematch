import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('escrow')
@UseGuards(JwtAuthGuard)
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEscrowDto) {
    return this.escrowService.create(user.id, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.escrowService.listForUser(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.escrowService.findById(id);
  }

  @Post(':id/fund')
  fund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrowService.fund(id, user.id);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrowService.complete(id, user.id);
  }

  @Post(':id/dispute')
  dispute(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrowService.dispute(id, user.id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrowService.cancel(id, user.id);
  }

  @Post(':id/refund')
  refund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.escrowService.refund(id, user.id);
  }
}
