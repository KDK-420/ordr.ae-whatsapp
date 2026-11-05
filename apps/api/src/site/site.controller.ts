import { Controller, Get, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { SiteService } from "./site.service";

/** Public, read-only: what a customer page shows. No login, and unpublished tenants look like they do not exist. */
@Controller("v1/sites")
export class SiteController {
  constructor(@Inject(SiteService) private readonly sites: SiteService) {}

  /** Caddy's on-demand TLS check: 200 means "issue a certificate for this host", anything else refuses. */
  @Get("tls-check")
  async tlsCheck(@Query("domain") domain: string | undefined) {
    if (!domain || !(await this.sites.allowsCertificate(domain))) throw new NotFoundException("no published site on that host");
    return { ok: true };
  }

  @Get(":slug")
  async site(@Param("slug") slug: string, @Query("lang") lang: string | undefined) {
    const site = await this.sites.publicSite(slug.toLowerCase(), lang);
    if (!site) throw new NotFoundException("no such site");
    return site;
  }
}
