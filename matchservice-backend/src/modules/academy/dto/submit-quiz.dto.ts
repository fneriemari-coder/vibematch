import { IsObject, IsString } from 'class-validator';

export class SubmitQuizDto {
  @IsString()
  quizId: string;

  /** Question index (as string key, e.g. "0") -> selected option index (0-3). */
  @IsObject()
  answers: Record<string, number>;
}
