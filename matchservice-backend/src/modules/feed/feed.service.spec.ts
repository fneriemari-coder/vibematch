import { FeedService } from './feed.service';
import { encodeCursor } from '../../common/pagination/cursor.util';

function post(id: string, likesCount: number, viewsCount: number, createdAt: Date) {
  return { id, likesCount, viewsCount, createdAt, tags: [], user: { id: 'author', profile: { name: 'Author' } } };
}

describe('FeedService.discover — keyset (cursor) pagination', () => {
  it('first page (no cursor) queries with no WHERE-cursor filter and returns an encoded nextCursor when full', async () => {
    const seekRows = [
      { id: 'p1', likesCount: 10, viewsCount: 5, createdAt: new Date('2026-01-03') },
      { id: 'p2', likesCount: 8, viewsCount: 4, createdAt: new Date('2026-01-02') },
    ];
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null) }, // not premium
      $queryRaw: jest.fn().mockResolvedValue(seekRows),
      discoveryPost: {
        findMany: jest.fn().mockResolvedValue(seekRows.map((r) => post(r.id, r.likesCount, r.viewsCount, r.createdAt))),
      },
    };
    const moderator = { moderate: jest.fn() };
    const service = new FeedService(prisma, moderator as any);

    const page = await service.discover('user-1', { limit: 2 } as any);

    expect(page.items.map((i) => i.postId)).toEqual(['p1', 'p2']);
    expect(page.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    expect(decoded.global).toEqual({ likesCount: 8, viewsCount: 4, createdAt: '2026-01-02T00:00:00.000Z', id: 'p2' });
    expect(decoded.local).toBeNull();
  });

  it('returns nextCursor=null once the page comes back shorter than the limit (stream exhausted)', async () => {
    const seekRows = [{ id: 'p1', likesCount: 10, viewsCount: 5, createdAt: new Date('2026-01-03') }];
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue(seekRows),
      discoveryPost: { findMany: jest.fn().mockResolvedValue([post('p1', 10, 5, new Date('2026-01-03'))]) },
    };
    const service = new FeedService(prisma, { moderate: jest.fn() } as any);

    const page = await service.discover('user-1', { limit: 10 } as any);

    expect(page.nextCursor).toBeNull();
  });

  it('a subsequent page passes the decoded cursor values into the raw SQL tuple comparison', async () => {
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      discoveryPost: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FeedService(prisma, { moderate: jest.fn() } as any);

    const cursor = encodeCursor({
      global: { likesCount: 8, viewsCount: 4, createdAt: '2026-01-02T00:00:00.000Z', id: 'p2' },
      local: null,
    });

    await service.discover('user-1', { limit: 10, cursor } as any);

    const sqlCall = prisma.$queryRaw.mock.calls[0][0];
    const sqlText = sqlCall.strings.join('?');
    expect(sqlText).toContain('likes_count, views_count, created_at, id');
    expect(sqlCall.values).toEqual(expect.arrayContaining([8, 4, '2026-01-02T00:00:00.000Z', 'p2']));
  });

  it('a stream marked exhausted (cursor.global === null) is not re-queried', async () => {
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      discoveryPost: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FeedService(prisma, { moderate: jest.fn() } as any);

    const cursor = encodeCursor({ global: null, local: null });
    const page = await service.discover('user-1', { limit: 10, cursor } as any);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor with a 400 rather than crashing', async () => {
    const prisma: any = { subscription: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new FeedService(prisma, { moderate: jest.fn() } as any);

    await expect(service.discover('user-1', { limit: 10, cursor: 'garbage' } as any)).rejects.toThrow();
  });
});
