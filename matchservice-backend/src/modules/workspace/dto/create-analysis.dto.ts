import { IsString, Length } from 'class-validator';

export class CreateAnalysisDto {
  /**
   * What the owner wants out of THIS document, in their own words.
   *
   * The 10-character floor keeps out "ok" and "analisa"; the analyser searches
   * the document for the terms of this question and leads the summary with
   * what it found, so a question with no content produces an analysis that
   * cannot lead with anything. The 600 ceiling bounds what is stored verbatim
   * and what is sent in a single model call.
   */
  @IsString()
  @Length(10, 600)
  question: string;
}
