import { rankProviders } from './workspace.service';

function provider(name: string, kScore: number, skills: string[]) {
  return {
    userId: name.toLowerCase(),
    name,
    headline: `${name} na VIBE MATCH`,
    skills,
    kScore,
    hourlyRate: null,
    rateCurrency: null,
  } as any;
}

/**
 * The contract analysis case that motivated this ordering: four findings all
 * point at contract and financial review, and the highest-scoring provider on
 * the platform matches only on STARTUPS.
 */
const WANTED = ['CONTROLLER', 'FINANCIAL_AUDIT', 'STARTUPS'];

describe('rankProviders', () => {
  it('puts the specialist ahead of a higher-scoring generalist', () => {
    const ranked = rankProviders(
      [
        provider('Leandro', 891, ['DESIGN', 'UI_UX', 'STARTUPS']),
        provider('Camila', 884, ['CONTROLLER', 'FINANCIAL_AUDIT', 'PAYMENTS']),
      ],
      WANTED,
    );

    expect(ranked.map((p) => p.name)).toEqual(['Camila', 'Leandro']);
  });

  it('falls back to K-Score between providers that match equally well', () => {
    const ranked = rankProviders(
      [
        provider('Menor', 700, ['CONTROLLER', 'FINANCIAL_AUDIT']),
        provider('Maior', 850, ['CONTROLLER', 'FINANCIAL_AUDIT']),
      ],
      WANTED,
    );

    expect(ranked.map((p) => p.name)).toEqual(['Maior', 'Menor']);
  });

  it('breaks a full tie by name so the same list never reorders between reads', () => {
    const ranked = rankProviders(
      [provider('Zeca', 800, ['CONTROLLER']), provider('Ana', 800, ['CONTROLLER'])],
      WANTED,
    );

    expect(ranked.map((p) => p.name)).toEqual(['Ana', 'Zeca']);
  });

  it('drops providers who match nothing the analysis asked for', () => {
    const ranked = rankProviders(
      [provider('Fora', 999, ['LOCAL_SEO']), provider('Dentro', 500, ['CONTROLLER'])],
      WANTED,
    );

    expect(ranked.map((p) => p.name)).toEqual(['Dentro']);
  });

  it('returns nothing when the analysis suggested no skills, rather than everyone', () => {
    expect(rankProviders([provider('Alguem', 900, ['CONTROLLER'])], [])).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => provider(`P${i}`, 500 + i, ['CONTROLLER']));
    expect(rankProviders(many, WANTED, 3)).toHaveLength(3);
  });
});
