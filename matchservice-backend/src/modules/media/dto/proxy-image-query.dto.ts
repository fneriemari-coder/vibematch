import { IsString, MaxLength } from 'class-validator';

export class ProxyImageQueryDto {
  /**
   * The (URL-encoded) absolute https image URL to re-serve. Everything about
   * whether it is *allowed* is decided in MediaProxyService.assertSafeUrl —
   * this DTO only bounds the input so a multi-megabyte query string can't be
   * used to make us do work.
   */
  @IsString()
  @MaxLength(2048)
  url!: string;
}
