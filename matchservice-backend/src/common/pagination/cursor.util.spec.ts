import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor.util';

describe('cursor.util', () => {
  it('round-trips an arbitrary payload', () => {
    const payload = { likesCount: 42, id: 'abc-123' };
    const cursor = encodeCursor(payload);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it('decodeCursor() returns null for undefined/empty input', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('decodeCursor() rejects a malformed cursor instead of crashing', () => {
    expect(() => decodeCursor('not-valid-base64-json')).toThrow(BadRequestException);
  });
});
