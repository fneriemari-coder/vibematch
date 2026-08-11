import { composeChatReply, composeFeedPost } from './simulation-content';
import { SPECIALTY_COUNT } from './simulation.core';

describe('simulation-content', () => {
  it('writes a different reply for each conversation turn', () => {
    const turns = [0, 1, 2].map((turn) => composeChatReply(0, 'match-1', turn));
    expect(new Set(turns).size).toBe(3);
  });

  it('is stable for the same bot, match and turn', () => {
    expect(composeChatReply(3, 'match-9', 1)).toBe(composeChatReply(3, 'match-9', 1));
  });

  it('does not put the same sentence in sixty mouths', () => {
    // Same specialty, same turn, different conversations: openers and closers
    // must still vary, otherwise the feed reads as a mail merge.
    const replies = new Set(
      Array.from({ length: 30 }, (_, i) => composeChatReply(i * SPECIALTY_COUNT, `match-${i}`, 0)),
    );
    expect(replies.size).toBeGreaterThan(20);
  });

  it('never emits placeholder copy', () => {
    for (let index = 0; index < SPECIALTY_COUNT; index++) {
      for (let turn = 0; turn < 3; turn++) {
        const reply = composeChatReply(index, 'match-x', turn);
        expect(reply.length).toBeGreaterThan(80);
        expect(reply.toLowerCase()).not.toContain('lorem');
        expect(reply.toLowerCase()).not.toContain('em breve');
      }
      const post = composeFeedPost(index, 0);
      expect(post.contentText.length).toBeGreaterThan(150);
      expect(post.tags.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives each specialty two distinct feed posts', () => {
    for (let index = 0; index < SPECIALTY_COUNT; index++) {
      expect(composeFeedPost(index, 0).title).not.toBe(composeFeedPost(index, 1).title);
    }
  });
});
