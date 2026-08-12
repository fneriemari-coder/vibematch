import { GrowthPillar } from '@prisma/client';
import { MARKET_SKILL_TAGS, analyzeSituation } from './growth-analyzer';

const FINANCE_SITUATION =
  'Faturei bem esse ano mas não sobra nada no fim do mês. Eu não sei quanto custa cada instalação que a gente ' +
  'entrega, então o preço sai no chute. Controlo tudo numa planilha que eu mesmo atualizo quando dá tempo.';

const SALES_SITUATION =
  'Recebo bastante contato pelo Instagram mas não consigo fechar quase nada. Mando o orçamento e o cliente ' +
  'some. Hoje quase todo trabalho novo vem por indicação de cliente antigo.';

const OPS_SITUATION =
  'Minha equipe vive apagando incêndio e a gente tem muito retrabalho: refazer serviço que já foi entregue ' +
  'virou rotina. Todo prazo estoura e no fim tudo passa por mim porque só eu sei como fazer.';

const TECH_SITUATION =
  'A gente anota pedido no caderno e depois alguém digita tudo de novo no sistema. Os dois sistemas não ' +
  'conversam, então o mesmo cadastro é preenchido manualmente duas vezes por dia.';

describe('growth-analyzer', () => {
  it('scores Finanças as the weakest pillar for a cost/cash-flow story', () => {
    const result = analyzeSituation(FINANCE_SITUATION);
    expect(result.weakestPillar).toBe(GrowthPillar.FINANCAS);
    expect(result.scores.FINANCAS).toBeLessThan(result.scores.VENDAS);
    expect(result.scores.FINANCAS).toBeLessThan(result.scores.GESTAO);
  });

  it('scores Vendas as the weakest pillar for a pipeline story', () => {
    expect(analyzeSituation(SALES_SITUATION).weakestPillar).toBe(GrowthPillar.VENDAS);
  });

  it('scores Gestão as the weakest pillar for a rework/centralization story', () => {
    expect(analyzeSituation(OPS_SITUATION).weakestPillar).toBe(GrowthPillar.GESTAO);
  });

  it('scores Tecnologia as the weakest pillar for a manual/integration story', () => {
    expect(analyzeSituation(TECH_SITUATION).weakestPillar).toBe(GrowthPillar.TECNOLOGIA);
  });

  it('keeps every score inside the radar range', () => {
    for (const situation of [FINANCE_SITUATION, SALES_SITUATION, OPS_SITUATION, TECH_SITUATION]) {
      for (const score of Object.values(analyzeSituation(situation).scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('quotes the manager back verbatim instead of writing generic copy', () => {
    const result = analyzeSituation(FINANCE_SITUATION);
    expect(result.summary).toContain('não sei quanto custa cada instalação');
    expect(result.summary).toContain('Finanças');
  });

  it('only ever suggests skills that exist in the platform vocabulary', () => {
    const allowed = new Set<string>(MARKET_SKILL_TAGS);
    for (const situation of [FINANCE_SITUATION, SALES_SITUATION, OPS_SITUATION, TECH_SITUATION]) {
      const { suggestedSkills } = analyzeSituation(situation);
      expect(suggestedSkills.length).toBeGreaterThan(0);
      for (const skill of suggestedSkills) expect(allowed.has(skill)).toBe(true);
    }
  });

  it('leads the briefing with skills for the weakest pillar', () => {
    expect(analyzeSituation(FINANCE_SITUATION).suggestedSkills).toContain('CONTROLLER');
    expect(analyzeSituation(TECH_SITUATION).suggestedSkills).toContain('AI_AUTOMATION');
  });

  it('returns real, distinct recommendations rather than placeholder text', () => {
    const { recommendations } = analyzeSituation(OPS_SITUATION);
    expect(recommendations.length).toBeGreaterThanOrEqual(2);
    expect(new Set(recommendations).size).toBe(recommendations.length);
    for (const recommendation of recommendations) expect(recommendation.length).toBeGreaterThan(40);
  });

  it('is deterministic — the same text always produces the same reading', () => {
    expect(analyzeSituation(FINANCE_SITUATION)).toEqual(analyzeSituation(FINANCE_SITUATION));
  });

  it('refuses to invent a weakness when the text carries no symptom', () => {
    const result = analyzeSituation(
      'Bom dia, tudo certo por aqui, só queria conhecer melhor essa plataforma nova de vocês hoje.',
    );
    expect(new Set(Object.values(result.scores)).size).toBe(1);
    expect(result.summary).toContain('sem evidência');
  });

  it('accents and casing do not change the reading', () => {
    const plain = analyzeSituation(
      'Nao sei quanto custa cada servico que entrego e o fluxo de caixa vive apertado todo mes aqui.',
    );
    const accented = analyzeSituation(
      'Não sei quanto custa cada serviço que entrego e o fluxo de caixa vive apertado todo mês aqui.',
    );
    expect(plain.weakestPillar).toBe(accented.weakestPillar);
    expect(plain.scores).toEqual(accented.scores);
  });
});
