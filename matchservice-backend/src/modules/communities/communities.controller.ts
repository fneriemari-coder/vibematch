import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Controller('communities')
@UseGuards(JwtAuthGuard)
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  /** All Círculos, cheapest tier first, with the caller's own seat/eligibility state resolved. */
  @Get()
  listCommunities(@CurrentUser() user: AuthenticatedUser) {
    return this.communitiesService.listCommunities(user.id);
  }

  /** Same card plus the active member list and the caller's own membership row. */
  @Get(':communityId')
  getCommunityDetail(@CurrentUser() user: AuthenticatedUser, @Param('communityId') communityId: string) {
    return this.communitiesService.getCommunityDetail(user.id, communityId);
  }

  /**
   * Opens a monthly Stripe Checkout Session and parks a PENDING seat. The
   * membership only becomes ACTIVE from the webhook — this route never grants
   * access on its own.
   */
  @Post(':communityId/apply')
  apply(@CurrentUser() user: AuthenticatedUser, @Param('communityId') communityId: string) {
    return this.communitiesService.apply(user.id, communityId);
  }
}
