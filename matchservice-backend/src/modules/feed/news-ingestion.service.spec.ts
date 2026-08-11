import { NewsIngestionService } from './news-ingestion.service';

/**
 * Fixtures, not live feeds. Real publishers are unreachable from CI, and more
 * importantly the thing worth pinning down is the *shape handling*: RSS 2.0
 * and Atom look nothing alike, and the image lives in a different place in
 * almost every feed. Each fixture below is modelled on a real-world shape.
 */

/** RSS 2.0 with Media RSS, an enclosure and an <img> buried in content:encoded. */
const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Portal de Engenharia</title>
    <link>https://engenharia.example</link>
    <item>
      <title>Nova norma de estruturas metálicas entra em vigor</title>
      <link>https://engenharia.example/norma-estruturas</link>
      <guid isPermaLink="false">engenharia-0001</guid>
      <pubDate>Mon, 04 Aug 2026 12:30:00 GMT</pubDate>
      <dc:creator>Ana Beatriz Lopes</dc:creator>
      <description><![CDATA[<p>A <strong>ABNT</strong> publicou a revisão da norma&nbsp;que define os critérios de dimensionamento.</p>]]></description>
      <media:content url="https://cdn.engenharia.example/fotos/norma.jpg" type="image/jpeg" medium="image" />
      <enclosure url="https://cdn.engenharia.example/fotos/enclosure.jpg" type="image/jpeg" length="120400" />
    </item>
    <item>
      <title>Obras de infraestrutura crescem 12%</title>
      <link>https://engenharia.example/infraestrutura</link>
      <guid isPermaLink="false">engenharia-0002</guid>
      <pubDate>Sun, 03 Aug 2026 09:00:00 GMT</pubDate>
      <description>Setor registra o melhor semestre desde 2019.</description>
      <media:thumbnail url="https://cdn.engenharia.example/fotos/thumb.jpg" />
    </item>
    <item>
      <title>Relatório trimestral do setor</title>
      <link>https://engenharia.example/relatorio</link>
      <guid isPermaLink="false">engenharia-0003</guid>
      <pubDate>Sat, 02 Aug 2026 09:00:00 GMT</pubDate>
      <description>Resumo do trimestre.</description>
      <enclosure url="https://cdn.engenharia.example/audio/podcast.mp3" type="audio/mpeg" length="8000000" />
      <content:encoded><![CDATA[<div><img src="https://cdn.engenharia.example/fotos/corpo.jpg" alt="grafico"/><p>Texto.</p></div>]]></content:encoded>
    </item>
    <item>
      <title>Item sem imagem alguma</title>
      <link>https://engenharia.example/sem-imagem</link>
      <pubDate>Fri, 01 Aug 2026 09:00:00 GMT</pubDate>
      <description>Nada de foto por aqui.</description>
    </item>
    <item>
      <link>https://engenharia.example/sem-titulo</link>
      <description>Sem título — deve ser descartado.</description>
    </item>
    <item>
      <title>Sem link — deve ser descartado</title>
      <description>Sem link.</description>
    </item>
  </channel>
</rss>`;

/** Atom 1.0: <entry>, <published>/<updated>, <summary>, <link rel="alternate">. */
const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Marketing Lab</title>
  <link href="https://marketinglab.example/" rel="alternate"/>
  <entry>
    <title>Como medir retenção sem cookies de terceiros</title>
    <link rel="alternate" href="https://marketinglab.example/retencao"/>
    <id>tag:marketinglab.example,2026:post-42</id>
    <published>2026-08-05T10:15:00Z</published>
    <updated>2026-08-06T08:00:00Z</updated>
    <author><name>Diego Fontes</name></author>
    <summary type="html">&lt;p&gt;Um guia prático para times pequenos.&lt;/p&gt;</summary>
    <media:content url="https://cdn.marketinglab.example/capa.png" type="image/png"/>
  </entry>
  <entry>
    <title>Entrada apenas com updated</title>
    <link rel="alternate" href="https://marketinglab.example/apenas-updated"/>
    <id>tag:marketinglab.example,2026:post-43</id>
    <updated>2026-07-30T22:00:00Z</updated>
    <content type="html">&lt;p&gt;Conteúdo com &lt;img src="https://cdn.marketinglab.example/inline.jpg"/&gt; embutido.&lt;/p&gt;</content>
  </entry>
</feed>`;

/** A YouTube channel feed — Atom plus <media:group>. */
const YOUTUBE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Canal de Gestão</title>
  <entry>
    <id>yt:video:AbC123xyz</id>
    <yt:videoId>AbC123xyz</yt:videoId>
    <title>Como estruturar o financeiro de uma PME</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AbC123xyz"/>
    <author><name>Canal de Gestão</name></author>
    <published>2026-08-07T14:00:00+00:00</published>
    <updated>2026-08-07T18:00:00+00:00</updated>
    <media:group>
      <media:title>Como estruturar o financeiro de uma PME</media:title>
      <media:content url="https://www.youtube.com/v/AbC123xyz?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i4.ytimg.com/vi/AbC123xyz/hqdefault.jpg" width="480" height="360"/>
      <media:description>Fluxo de caixa, DRE e o mínimo de governança que uma PME precisa.</media:description>
    </media:group>
  </entry>
</feed>`;

describe('NewsIngestionService — feed parsing', () => {
  const service = new NewsIngestionService({} as any);

  describe('RSS 2.0', () => {
    it('parses items, strips HTML from the publisher excerpt and keeps the guid as externalId', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);

      expect(items).toHaveLength(4); // the two malformed entries are dropped
      expect(items[0]).toMatchObject({
        externalId: 'engenharia-0001',
        title: 'Nova norma de estruturas metálicas entra em vigor',
        url: 'https://engenharia.example/norma-estruturas',
        author: 'Ana Beatriz Lopes',
        videoUrl: null,
      });
      expect(items[0].summary).toBe(
        'A ABNT publicou a revisão da norma que define os critérios de dimensionamento.',
      );
      expect(items[0].publishedAt.toISOString()).toBe('2026-08-04T12:30:00.000Z');
    });

    it('skips entries with no title or no url — they are unrenderable and unlinkable', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      expect(items.map((i) => i.url)).not.toContain('https://engenharia.example/sem-titulo');
      expect(items.map((i) => i.title)).not.toContain('Sem link — deve ser descartado');
    });

    it('falls back to the link when the feed omits a guid', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      const noGuid = items.find((i) => i.url === 'https://engenharia.example/sem-imagem');
      expect(noGuid?.externalId).toBe('https://engenharia.example/sem-imagem');
    });
  });

  describe('image extraction priority', () => {
    it('prefers media:content over a competing enclosure', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      expect(items[0].imageUrl).toBe('https://cdn.engenharia.example/fotos/norma.jpg');
    });

    it('falls back to media:thumbnail', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      expect(items[1].imageUrl).toBe('https://cdn.engenharia.example/fotos/thumb.jpg');
    });

    it('ignores a non-image enclosure and reads the first <img> out of content:encoded', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      expect(items[2].imageUrl).toBe('https://cdn.engenharia.example/fotos/corpo.jpg');
    });

    it('returns null rather than inventing a URL when a feed carries no image at all', async () => {
      const items = await service.parseFeed(RSS_FIXTURE);
      expect(items[3].imageUrl).toBeNull();
    });

    it('takes an image enclosure when there is no media:* element', async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
        <item>
          <title>Só enclosure</title>
          <link>https://x.example/a</link>
          <description>d</description>
          <enclosure url="https://cdn.x.example/a.jpg" type="image/jpeg" length="1"/>
        </item></channel></rss>`;
      const [item] = await service.parseFeed(xml);
      expect(item.imageUrl).toBe('https://cdn.x.example/a.jpg');
    });
  });

  describe('Atom 1.0', () => {
    it('parses <entry>/<published>/<summary> and prefers published over updated', async () => {
      const items = await service.parseFeed(ATOM_FIXTURE);

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        externalId: 'tag:marketinglab.example,2026:post-42',
        title: 'Como medir retenção sem cookies de terceiros',
        url: 'https://marketinglab.example/retencao',
        author: 'Diego Fontes',
        imageUrl: 'https://cdn.marketinglab.example/capa.png',
      });
      expect(items[0].summary).toBe('Um guia prático para times pequenos.');
      expect(items[0].publishedAt.toISOString()).toBe('2026-08-05T10:15:00.000Z');
    });

    it('falls back to <updated> when an entry has no <published>', async () => {
      const items = await service.parseFeed(ATOM_FIXTURE);
      expect(items[1].publishedAt.toISOString()).toBe('2026-07-30T22:00:00.000Z');
    });

    it('pulls an inline <img> out of Atom <content> when nothing better exists', async () => {
      const items = await service.parseFeed(ATOM_FIXTURE);
      expect(items[1].imageUrl).toBe('https://cdn.marketinglab.example/inline.jpg');
    });
  });

  describe('YouTube channel feed (mediaKind VIDEO)', () => {
    it('takes the thumbnail from media:group and the entry link as videoUrl', async () => {
      const [item] = await service.parseFeed(YOUTUBE_FIXTURE, true);

      expect(item).toMatchObject({
        externalId: 'yt:video:AbC123xyz',
        title: 'Como estruturar o financeiro de uma PME',
        url: 'https://www.youtube.com/watch?v=AbC123xyz',
        videoUrl: 'https://www.youtube.com/watch?v=AbC123xyz',
        imageUrl: 'https://i4.ytimg.com/vi/AbC123xyz/hqdefault.jpg',
      });
      // NOT the media:content Flash URL, which is not an image.
      expect(item.imageUrl).not.toContain('/v/AbC123xyz');
      expect(item.summary).toBe('Fluxo de caixa, DRE e o mínimo de governança que uma PME precisa.');
    });
  });

  describe('summary handling', () => {
    it('truncates a long excerpt to ~320 characters on a word boundary', async () => {
      const long = 'palavra '.repeat(120).trim();
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
        <item><title>Longo</title><link>https://x.example/l</link>
        <description>${long}</description></item></channel></rss>`;

      const [item] = await service.parseFeed(xml);
      expect(item.summary.length).toBeLessThanOrEqual(321); // 320 + the ellipsis
      expect(item.summary.endsWith('…')).toBe(true);
      expect(item.summary).not.toMatch(/palavr…$/); // cut between words, not mid-word
    });

    it('never stores the article body — only what the feed itself published', async () => {
      // content:encoded here holds the "full article"; the description is the
      // publisher's own excerpt, and that is what must win.
      const xml = `<?xml version="1.0"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel><title>t</title>
        <item>
          <title>Matéria</title>
          <link>https://x.example/m</link>
          <description>Resumo curto da matéria.</description>
          <content:encoded><![CDATA[<p>CORPO INTEIRO DA MATERIA QUE NAO PODE SER ARMAZENADO</p>]]></content:encoded>
        </item></channel></rss>`;

      const [item] = await service.parseFeed(xml);
      expect(item.summary).toBe('Resumo curto da matéria.');
      expect(item.summary).not.toContain('CORPO INTEIRO');
    });
  });

  it('rejects XML that is not a feed at all, so a host serving an error page is a per-source failure', async () => {
    await expect(service.parseFeed('<html><body>403 Forbidden</body></html>')).rejects.toThrow();
  });
});
