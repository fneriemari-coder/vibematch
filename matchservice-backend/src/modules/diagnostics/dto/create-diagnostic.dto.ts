import { IsString, Length } from 'class-validator';

export class CreateDiagnosticDto {
  /**
   * What the manager is actually living with, in their own words.
   *
   * The 40-character floor is not cosmetic: both the model prompt and the
   * local analyser read this text for evidence, and "vendas fracas" carries
   * none. The 4000 ceiling keeps a single request inside one model call and
   * bounds what is stored verbatim.
   */
  @IsString()
  @Length(40, 4000)
  situation: string;
}
