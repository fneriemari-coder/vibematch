import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601 } from 'class-validator';

/** Adds more bookable instants to an offering the caller already owns. */
export class AddSlotsDto {
  @IsArray()
  @IsISO8601({}, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  slots: string[];
}
