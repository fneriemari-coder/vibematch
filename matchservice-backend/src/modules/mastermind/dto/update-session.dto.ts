import { IsUrl } from 'class-validator';

/** Lets a host attach the real stream link once it exists (e.g. right before going live). */
export class UpdateMastermindSessionDto {
  @IsUrl()
  liveStreamUrl: string;
}
