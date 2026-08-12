import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';
import { CreateDiagnosticDto } from './dto/create-diagnostic.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('diagnostics')
@UseGuards(JwtAuthGuard)
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  /** Scores the caller's company across the four pillars and stores the reading. */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDiagnosticDto) {
    return this.diagnosticsService.create(user.id, dto);
  }

  /** The caller's own readings, newest first — powers the radar history. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.diagnosticsService.listForUser(user.id);
  }

  /** Owner-only; 403 for anyone else. See DiagnosticsService.findOne. */
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.diagnosticsService.findOne(user.id, id);
  }
}
