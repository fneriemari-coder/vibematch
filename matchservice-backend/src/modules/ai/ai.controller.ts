import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiTranslatorService } from './ai-translator.service';
import { AiTranslateDto } from './dto/ai-translate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiTranslatorService: AiTranslatorService) {}

  @Post('translate')
  translate(@CurrentUser() user: AuthenticatedUser, @Body() dto: AiTranslateDto) {
    return this.aiTranslatorService.translate(user.id, dto);
  }
}
