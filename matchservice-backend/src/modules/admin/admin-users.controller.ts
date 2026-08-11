import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto';
import { SetIdentityVerifiedDto } from './dto/set-identity-verified.dto';
import { SetMentorDto } from './dto/set-mentor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminUsersService.listUsers(query);
  }

  @Get(':userId')
  getUserDetail(@Param('userId') userId: string) {
    return this.adminUsersService.getUserDetail(userId);
  }

  /** Ban/suspend/reactivate — AccountStatus.SUSPENDED is the "ban" state. */
  @Patch(':userId/account-status')
  updateAccountStatus(@Param('userId') userId: string, @Body() dto: UpdateAccountStatusDto) {
    return this.adminUsersService.updateAccountStatus(userId, dto.accountStatus);
  }

  /** Manual identity-verification override — the "approve" action. */
  @Patch(':userId/identity-verified')
  setIdentityVerified(@Param('userId') userId: string, @Body() dto: SetIdentityVerifiedDto) {
    return this.adminUsersService.setIdentityVerified(userId, dto.identityVerified);
  }

  /** Elevates a user into (or out of) the curated mentors group — see GET /academy/mentors. */
  @Patch(':userId/mentor')
  setMentor(@Param('userId') userId: string, @Body() dto: SetMentorDto) {
    return this.adminUsersService.setMentor(userId, dto);
  }
}
