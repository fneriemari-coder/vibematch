import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { DataPrivacyService } from './data-privacy.service';
import { UpdateProfileDto, NearbyQueryDto, UpdateFcmTokenDto } from './dto/update-profile.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly dataPrivacyService: DataPrivacyService,
  ) {}

  @Get('me/profile')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me/profile')
  updateMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('nearby')
  findNearby(@Query() query: NearbyQueryDto) {
    return this.usersService.findNearby(query);
  }

  @Put('fcm-token')
  updateFcmToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateFcmTokenDto) {
    return this.usersService.updateFcmToken(user.id, dto.fcmToken);
  }

  @Get(':id/score')
  getScore(@Param('id') id: string) {
    return this.usersService.getScore(id);
  }

  /** LGPD/GDPR data-portability export — every table where this user's data lives. */
  @Get('me/data-export')
  exportMyData(@CurrentUser() user: AuthenticatedUser) {
    return this.dataPrivacyService.exportMyData(user.id);
  }

  /** LGPD/GDPR "right to erasure" — anonymizes PII; see DataPrivacyService's doc comment for exactly what is and isn't erased. */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: DeleteAccountDto) {
    await this.dataPrivacyService.deleteMyAccount(user.id, dto.password);
  }
}
