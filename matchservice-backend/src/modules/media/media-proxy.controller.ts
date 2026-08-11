import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MediaProxyService } from './media-proxy.service';
import { ProxyImageQueryDto } from './dto/proxy-image-query.dto';

/**
 * Deliberately a SEPARATE controller from MediaController, which wraps every
 * route in JwtAuthGuard at the class level. There is no @Public() decorator
 * in this codebase — the established way a route stays unauthenticated is to
 * live on a controller that simply doesn't declare the guard (see
 * fintech/stripe-webhook.controller.ts), which is what this is.
 *
 * It HAS to be unauthenticated. The client renders these through
 * CachedNetworkImage, i.e. an ordinary browser image request that carries no
 * Authorization header; behind JwtAuthGuard every cover in the feed would
 * 401 and we would be back to the empty-looking feed the proxy exists to fix.
 *
 * Because anonymous callers can reach it, the SSRF allowlist in
 * MediaProxyService is the ENTIRE security boundary — it can only ever
 * re-serve an image whose host already appears in a NewsItem we ingested
 * ourselves. Nothing here reads user data or mutates state. The throttle is
 * the abuse control: this is the only unauthenticated data-fetching endpoint
 * in the app, and an open image proxy is free bandwidth for whoever finds it.
 */
@Controller('media')
export class MediaProxyController {
  constructor(private readonly mediaProxyService: MediaProxyService) {}

  @Get('proxy')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  // A day of browser/CDN caching: these are immutable published thumbnails,
  // and it keeps repeat scrolls off both our egress and the publisher's.
  @Header('Cache-Control', 'public, max-age=86400')
  // Wildcard CORS, on purpose and safely: the response is a public image the
  // caller already named, it carries no credentials and no user data, and
  // CanvasKit decodes images through XHR — without this header it refuses to
  // paint them, which is the exact failure this endpoint was built to fix.
  // The app's global enableCors() allowlist is for credentialed API calls; it
  // would not match an <img>-style request, so we set it explicitly here.
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async proxy(@Query() query: ProxyImageQueryDto, @Res() res: Response): Promise<void> {
    const { contentType, body } = await this.mediaProxyService.fetchImage(query.url);

    res.setHeader('Content-Type', contentType);
    // Belt and braces: never let a proxied byte stream be interpreted as a
    // document by a browser that ignores the image/* content type.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    try {
      for await (const chunk of this.mediaProxyService.streamCapped(body)) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      // Once the first byte is out, the status line is already on the wire and
      // no exception filter can turn this into a 413. Destroying the socket is
      // the only honest signal left: the client sees a truncated transfer and
      // discards it, rather than caching a half-image as if it were complete.
      // (This is the "upstream lied about Content-Length" path — the cap in
      // streamCapped is what actually stops us relaying an unbounded body.)
      res.destroy(err as Error);
    }
  }
}
