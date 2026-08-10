import { BadRequestException } from '@nestjs/common';

/**
 * Opaque keyset-pagination cursor — base64url-encodes whatever tuple of
 * "last seen row" sort-key values a query needs, so the client never has to
 * understand or construct it. Using this instead of OFFSET means every page
 * after the first is answered with an index seek on the sort columns
 * (`WHERE (sort_cols...) < (cursor_values...) ORDER BY sort_cols... LIMIT n`)
 * rather than a scan-and-discard of `offset` rows — the query cost stays
 * flat instead of growing with how deep the client has paged.
 */
export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined | null): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
