import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MediaProxyService } from './media-proxy.service';

/**
 * These tests are the specification for the SSRF gate, not incidental
 * coverage. GET /media/proxy takes a URL straight from an unauthenticated
 * client; if `assertSafeUrl` regresses, the endpoint becomes a way to make
 * our server fetch cloud metadata and internal services on an attacker's
 * behalf.
 */
describe('MediaProxyService — SSRF guard', () => {
  /**
   * Every allowlist lookup is faked to "yes" on purpose: it proves the
   * scheme and private-range checks stand on their own, rather than passing
   * only because the host happened not to be in the DB.
   */
  function buildService(allowedHosts: string[] = ['cdn.publisher.example']) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(allowedHosts.map((host) => ({ host }))),
    };
    return new MediaProxyService(prisma as any);
  }

  describe('rejects non-https schemes', () => {
    it.each([
      'http://cdn.publisher.example/a.jpg',
      'file:///etc/passwd',
      'ftp://cdn.publisher.example/a.jpg',
      'gopher://cdn.publisher.example:70/a',
      'data:image/png;base64,iVBORw0KGgo=',
    ])('%s', async (url) => {
      await expect(buildService().assertSafeUrl(url)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('rejects a malformed url instead of throwing something unhandled', async () => {
    await expect(buildService().assertSafeUrl('not a url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects embedded credentials, which are used to confuse host parsing', async () => {
    await expect(
      buildService().assertSafeUrl('https://cdn.publisher.example@169.254.169.254/latest/meta-data/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('rejects private, loopback and link-local IP literals', () => {
    it.each([
      ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
      ['loopback', 'https://127.0.0.1/admin'],
      ['loopback range', 'https://127.99.12.3/admin'],
      ['RFC1918 10/8', 'https://10.0.0.5/internal'],
      ['RFC1918 172.16/12', 'https://172.16.4.1/internal'],
      ['RFC1918 172.31/12 upper bound', 'https://172.31.255.254/internal'],
      ['RFC1918 192.168/16', 'https://192.168.1.1/router'],
      ['this-network 0/8', 'https://0.0.0.0/'],
      ['CGNAT 100.64/10', 'https://100.64.0.1/'],
      ['IPv6 loopback', 'https://[::1]/admin'],
      ['IPv6 unique-local fc00::/7', 'https://[fd00::1]/internal'],
      ['IPv6 link-local fe80::/10', 'https://[fe80::1]/internal'],
      ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/admin'],
      ['IPv4-mapped IPv6 metadata', 'https://[::ffff:169.254.169.254]/'],
    ])('%s', async (_label, url) => {
      // Allowlisted on purpose — the IP check must reject it anyway.
      const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
      await expect(buildService([host]).assertSafeUrl(url)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('rejects a public host that is not one we ingested an image from', async () => {
    await expect(
      buildService(['cdn.publisher.example']).assertSafeUrl('https://evil.example/a.jpg'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a host that resolves to a private address (DNS-based bypass)', async () => {
    const service = buildService(['rebind.publisher.example']);
    jest.spyOn(service as any, 'resolveAll').mockResolvedValue(['10.1.2.3']);

    await expect(service.assertSafeUrl('https://rebind.publisher.example/a.jpg')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a host that resolves to a mix of public and private addresses', async () => {
    const service = buildService(['mixed.publisher.example']);
    jest.spyOn(service as any, 'resolveAll').mockResolvedValue(['93.184.216.34', '169.254.169.254']);

    await expect(service.assertSafeUrl('https://mixed.publisher.example/a.jpg')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('accepts an allowlisted https host that resolves to a public address', async () => {
    const service = buildService(['cdn.publisher.example']);
    jest.spyOn(service as any, 'resolveAll').mockResolvedValue(['93.184.216.34']);

    const url = await service.assertSafeUrl('https://cdn.publisher.example/photo.jpg?w=800');
    expect(url.hostname).toBe('cdn.publisher.example');
  });

  it('fails closed when the host cannot be resolved', async () => {
    const service = buildService(['gone.publisher.invalid']);
    await expect(service.assertSafeUrl('https://gone.publisher.invalid/a.jpg')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('isPrivateAddress', () => {
    const service = new MediaProxyService({} as any);

    it.each(['10.0.0.1', '172.20.0.1', '192.168.0.1', '127.0.0.1', '169.254.169.254', '::1', 'fd12::1', 'fe80::1', '224.0.0.1', 'not-an-ip'])(
      'treats %s as private/unsafe',
      (address) => {
        expect(service.isPrivateAddress(address)).toBe(true);
      },
    );

    it.each(['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
      'treats %s as public',
      (address) => {
        expect(service.isPrivateAddress(address)).toBe(false);
      },
    );
  });
});
