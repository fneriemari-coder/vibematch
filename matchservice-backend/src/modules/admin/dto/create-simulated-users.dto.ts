import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import type { SimulatedCountry, SimulatedRole } from '../simulation.core';

/**
 * Body of POST /admin/simulation/users.
 *
 * `role` is deliberately an `@IsIn` over three values rather than
 * `@IsEnum(Role)` — ADMIN is a member of that enum, and a route that mints
 * users must never be able to mint administrators.
 */
export class CreateSimulatedUsersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count: number;

  @IsOptional()
  @IsIn(['BR', 'US'])
  country?: SimulatedCountry;

  @IsOptional()
  @IsIn([Role.PROVIDER, Role.CLIENT, Role.BOTH])
  role?: SimulatedRole;
}
