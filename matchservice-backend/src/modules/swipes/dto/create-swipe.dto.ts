import { IsEnum, IsString } from 'class-validator';
import { SwipeDirection, SwipeMode } from '@prisma/client';

export class CreateSwipeDto {
  @IsString()
  swipedId: string;

  @IsEnum(SwipeDirection)
  direction: SwipeDirection;

  @IsEnum(SwipeMode)
  mode: SwipeMode;
}
