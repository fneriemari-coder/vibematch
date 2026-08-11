import { Role } from '@prisma/client';
import {
  SIMULATED_EMAIL_DOMAIN,
  buildSimulatedPerson,
  buildSimulatedPopulation,
  deterministicUnitFor,
  parseSimulatedIndex,
  specialtyKeyFor,
} from './simulation.core';

const FIXED_NOW = Date.parse('2026-08-11T12:00:00.000Z');

describe('simulation.core', () => {
  it('is deterministic: the same index always yields the same person', () => {
    const a = buildSimulatedPerson(37, { now: FIXED_NOW });
    const b = buildSimulatedPerson(37, { now: FIXED_NOW });
    expect(b).toEqual(a);
  });

  it('gives every person a distinct address on the reserved domain', () => {
    const people = buildSimulatedPopulation(120, 0, { now: FIXED_NOW });
    const emails = new Set(people.map((p) => p.email));

    expect(emails.size).toBe(120);
    for (const person of people) {
      expect(person.email.endsWith(`@${SIMULATED_EMAIL_DOMAIN}`)).toBe(true);
    }
  });

  it('round-trips the generation index through the e-mail', () => {
    const person = buildSimulatedPerson(84, { now: FIXED_NOW });
    expect(parseSimulatedIndex(person.email)).toBe(84);
  });

  it('refuses to recognise a real address as simulated', () => {
    // The behavioural bots key entirely off this: a real account must never
    // parse as one of ours.
    expect(parseSimulatedIndex('someone@gmail.com')).toBeNull();
    expect(parseSimulatedIndex('sim.fake.1@matchservice.dev')).toBeNull();
    expect(parseSimulatedIndex('seed.creator.ai@matchservice.dev')).toBeNull();
  });

  it('keeps every generated field inside its documented range', () => {
    for (const person of buildSimulatedPopulation(200, 0, { now: FIXED_NOW })) {
      expect(person.averageRating).toBeGreaterThanOrEqual(3.8);
      expect(person.averageRating).toBeLessThanOrEqual(5);
      expect(person.skills.length).toBeGreaterThanOrEqual(3);
      expect(person.skills.length).toBeLessThanOrEqual(5);
      expect(person.bio.length).toBeGreaterThan(120);
      expect(person.hourlyRate).toBeGreaterThan(0);
      expect(person.score.financialHealthScore).toBeGreaterThanOrEqual(0);
      expect(person.score.financialHealthScore).toBeLessThanOrEqual(1000);
      // 90-day spread, inclusive of "today".
      const daysAgo = (FIXED_NOW - person.createdAt.getTime()) / 86_400_000;
      expect(daysAgo).toBeGreaterThanOrEqual(0);
      expect(daysAgo).toBeLessThan(90);
    }
  });

  it('leaves roughly a third of the population on B2B networking', () => {
    const people = buildSimulatedPopulation(90, 0, { now: FIXED_NOW });
    expect(people.filter((p) => p.b2bNetworking).length).toBe(30);
  });

  it('fills the swipe deck: most people are swipeable providers', () => {
    const people = buildSimulatedPopulation(100, 0, { now: FIXED_NOW });
    const swipeable = people.filter((p) => p.role !== Role.CLIENT);
    expect(swipeable.length).toBeGreaterThanOrEqual(85);
  });

  it('honours an explicit role and country', () => {
    const person = buildSimulatedPerson(5, { now: FIXED_NOW, role: Role.CLIENT, country: 'US' });
    expect(person.role).toBe(Role.CLIENT);
    expect(person.country).toBe('US');
    expect(person.rateCurrency).toBe('USD');
  });

  it('scatters coordinates around real Brazilian cities', () => {
    for (const person of buildSimulatedPopulation(60, 0, { now: FIXED_NOW })) {
      expect(person.latitude).toBeGreaterThan(-34);
      expect(person.latitude).toBeLessThan(-5);
      expect(person.longitude).toBeGreaterThan(-55);
      expect(person.longitude).toBeLessThan(-33);
    }
    // Distinct coordinates are what LOCAL mode sorts on — identical points
    // would make the distance ordering meaningless.
    const points = new Set(buildSimulatedPopulation(60, 0, { now: FIXED_NOW }).map((p) => `${p.latitude},${p.longitude}`));
    expect(points.size).toBe(60);
  });

  it('resolves a swipe-back coin flip the same way every time', () => {
    const first = deterministicUnitFor('user-a', 'user-b', 'CLOUD');
    expect(deterministicUnitFor('user-a', 'user-b', 'CLOUD')).toBe(first);
    // Order matters, so A→B and B→A are independent decisions.
    expect(deterministicUnitFor('user-b', 'user-a', 'CLOUD')).not.toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('maps an index to a stable specialty', () => {
    expect(specialtyKeyFor(0)).toBe(specialtyKeyFor(15));
    expect(specialtyKeyFor(0)).not.toBe(specialtyKeyFor(1));
  });
});
