import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Why this endpoint exists at all:
 *
 * Flutter web renders through CanvasKit, which loads images with XHR rather
 * than a plain <img> tag — so the browser enforces CORS on them. Publisher
 * image CDNs essentially never send `Access-Control-Allow-Origin`, so a
 * hot-linked news thumbnail silently fails to decode and the Radar feed
 * renders as a wall of empty grey cards. Re-serving those bytes from our own
 * origin is what makes the pictures actually appear.
 *
 * Why it is written this defensively:
 *
 * The endpoint takes a URL from the client, which makes it a textbook SSRF
 * primitive — "please, server, fetch http://169.254.169.254/latest/meta-data/"
 * or an internal service that is only reachable from inside our network. The
 * controls below are layered, and the ORDER matters:
 *
 *   1. https only (no http:, no file:, no gopher:, no redirect-to-those)
 *   2. host must appear in an image URL we ourselves already ingested — so
 *      the reachable set is exactly the images we chose to store, never an
 *      arbitrary address of the caller's choosing
 *   3. every resolved IP must be publicly routable — private, loopback,
 *      link-local, CGNAT and multicast ranges are rejected
 *   4. re-run 1-3 on every redirect hop (an allowed host redirecting to
 *      169.254.169.254 is the classic bypass), and follow at most 2
 *   5. the response must be an image, under 5 MB, within 10s
 *
 * Control 2 is the one doing the heavy lifting; 3 is defence in depth for the
 * case where an allowlisted publisher's DNS record is compromised or points
 * somewhere internal. Note that 3 has an inherent DNS-rebinding window (we
 * resolve, then `fetch` resolves again), which is precisely why we do not
 * rely on it alone.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
/** The allowlist changes only when ingestion runs (hourly), so a short cache is free. */
const ALLOWLIST_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class MediaProxyService {
  private allowedHosts: Set<string> | null = null;
  private allowedHostsLoadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates the request, then returns the upstream response body for the
   * controller to pipe. Returns the stream rather than a Buffer so a 5 MB
   * image never has to sit in the heap in one piece.
   */
  async fetchImage(rawUrl: string): Promise<{ contentType: string; body: ReadableStream<Uint8Array> }> {
    let target = await this.assertSafeUrl(rawUrl);
    let redirects = 0;

    for (;;) {
      const response = await fetch(target.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Manual, so every hop is re-validated instead of the runtime quietly
        // following a redirect into a private address for us.
        redirect: 'manual',
        headers: { Accept: 'image/*', 'User-Agent': 'VibeMatchRadar/1.0 (+https://vibematch.app)' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new BadRequestException('Upstream redirect without a Location header');
        if (redirects >= MAX_REDIRECTS) throw new BadRequestException('Too many redirects');
        redirects += 1;
        // Resolved against the current URL so a relative Location works, then
        // put through the full scheme/host/IP check again.
        target = await this.assertSafeUrl(new URL(location, target).toString());
        continue;
      }

      if (!response.ok || !response.body) {
        throw new BadRequestException(`Upstream responded ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new BadRequestException('Upstream resource is not an image');
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength > MAX_BYTES) {
        throw new PayloadTooLargeException('Image exceeds the 5 MB proxy limit');
      }

      return { contentType, body: response.body };
    }
  }

  /**
   * Reads the upstream stream in chunks, enforcing the byte cap as it goes —
   * a lying (or absent) Content-Length must not let an attacker stream us an
   * unbounded body.
   */
  async *streamCapped(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          throw new PayloadTooLargeException('Image exceeds the 5 MB proxy limit');
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * The whole SSRF gate. Exported behaviour, not an implementation detail —
   * see media-proxy.service.spec.ts.
   */
  async assertSafeUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Malformed url');
    }

    // https only. http: would let a network attacker swap the bytes, and
    // file:/gopher:/ftp: are the classic SSRF escalation schemes.
    if (url.protocol !== 'https:') {
      throw new BadRequestException('Only https URLs can be proxied');
    }

    // Credentials in the URL are never legitimate here and are a common way
    // to confuse naive host parsing (https://allowed.com@evil.com/).
    if (url.username || url.password) {
      throw new BadRequestException('Credentials are not allowed in a proxied URL');
    }

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Check the literal first: an IP-literal URL never needs DNS, and this is
    // the direct form of the attack (https://169.254.169.254/...).
    if (isIP(host) && this.isPrivateAddress(host)) {
      throw new ForbiddenException('Refusing to proxy a private or loopback address');
    }

    if (!(await this.isAllowedHost(host))) {
      throw new ForbiddenException('Host is not an ingested content source');
    }

    for (const address of await this.resolveAll(host)) {
      if (this.isPrivateAddress(address)) {
        throw new ForbiddenException('Refusing to proxy a private or loopback address');
      }
    }

    return url;
  }

  /**
   * The allowlist is derived from the DB rather than hardcoded: we only ever
   * proxy a host that already appears in a `NewsItem.imageUrl` we ingested
   * ourselves. That means adding a publisher to the Radar automatically
   * allows its CDN, and nothing else is reachable — no config file to drift
   * out of sync, and no way for a caller to name a host we never chose.
   */
  private async isAllowedHost(host: string): Promise<boolean> {
    const hosts = await this.loadAllowedHosts();
    return hosts.has(host);
  }

  private async loadAllowedHosts(): Promise<Set<string>> {
    const fresh = this.allowedHosts && Date.now() - this.allowedHostsLoadedAt < ALLOWLIST_TTL_MS;
    if (fresh && this.allowedHosts) return this.allowedHosts;

    // DISTINCT on the extracted host rather than on the whole URL: a few
    // dozen CDN hostnames instead of tens of thousands of image URLs.
    const rows = await this.prisma.$queryRaw<Array<{ host: string | null }>>`
      SELECT DISTINCT lower(split_part(split_part(split_part(image_url, '://', 2), '/', 1), ':', 1)) AS host
      FROM news_items
      WHERE image_url IS NOT NULL AND image_url LIKE 'https://%';
    `;

    this.allowedHosts = new Set(rows.map((r) => r.host).filter((h): h is string => Boolean(h)));
    this.allowedHostsLoadedAt = Date.now();
    return this.allowedHosts;
  }

  private async resolveAll(host: string): Promise<string[]> {
    if (isIP(host)) return [host];
    try {
      const records = await lookup(host, { all: true });
      if (records.length === 0) throw new Error('empty DNS answer');
      return records.map((r) => r.address);
    } catch {
      // Fail closed — an unresolvable host is not something we proxy.
      throw new BadRequestException('Could not resolve the image host');
    }
  }

  /**
   * True for anything that is not publicly routable. Covers the ranges an
   * SSRF actually targets: cloud metadata (169.254.0.0/16), loopback
   * (127.0.0.0/8, ::1), RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT
   * (100.64/10), IPv6 unique-local (fc00::/7) and link-local (fe80::/10),
   * plus the unspecified/multicast/reserved blocks.
   */
  isPrivateAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) return this.isPrivateIPv4(address);
    if (version === 6) return this.isPrivateIPv6(address.toLowerCase());
    // Not an IP at all — treat as unsafe rather than assuming it's fine.
    return true;
  }

  private isPrivateIPv4(address: string): boolean {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;

    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 192 && b === 0) return true; // IETF protocol assignments (incl. 192.0.0.0/24)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  /**
   * Works on the fully expanded 8-group form rather than on the text, because
   * the text form is not canonical: `new URL()` rewrites
   * `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so a regex looking for the
   * dotted-quad spelling misses the exact bypass it was written to catch.
   */
  private isPrivateIPv6(address: string): boolean {
    const groups = this.expandIPv6(address);
    if (!groups) return true; // unparseable — treat as unsafe

    // ::  (unspecified) and ::1 (loopback)
    const allZeroHead = groups.slice(0, 7).every((g) => g === 0);
    if (allZeroHead && (groups[7] === 0 || groups[7] === 1)) return true;

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) smuggle a
    // v4 address through a v6 literal — unwrap and re-check as IPv4.
    const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
    const isCompatible = groups.slice(0, 6).every((g) => g === 0);
    if (isMapped || isCompatible) {
      const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
      return this.isPrivateIPv4(v4);
    }

    const prefix = groups[0];
    if ((prefix & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((prefix & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((prefix & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }

  /** `fd00::1` -> the eight 16-bit groups, or null if it isn't a valid IPv6 literal. */
  private expandIPv6(address: string): number[] | null {
    // A trailing dotted-quad (::ffff:169.254.169.254) has to become two hex
    // groups before the `::` expansion arithmetic can work.
    const dotted = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    let text = address;
    if (dotted) {
      const octets = dotted[2].split('.').map(Number);
      if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
      const hi = ((octets[0] << 8) | octets[1]).toString(16);
      const lo = ((octets[2] << 8) | octets[3]).toString(16);
      text = `${dotted[1]}${hi}:${lo}`;
    }

    const [head, tail, ...extra] = text.split('::');
    if (extra.length > 0) return null; // more than one "::" is invalid

    const parse = (part: string): number[] =>
      part === '' ? [] : part.split(':').map((g) => parseInt(g, 16));

    const left = parse(head);
    const right = tail === undefined ? [] : parse(tail);
    if ([...left, ...right].some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;

    if (tail === undefined) return left.length === 8 ? left : null;

    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    return [...left, ...Array<number>(fill).fill(0), ...right];
  }

  /** Test seam / cache buster — ingestion adding a new CDN shouldn't wait 5 minutes. */
  invalidateAllowedHosts(): void {
    this.allowedHosts = null;
    this.allowedHostsLoadedAt = 0;
  }
}
