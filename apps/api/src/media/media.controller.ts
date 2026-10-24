import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, PayloadTooLargeException, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import type { AppConfig } from "../config";
import type { MediaRepository } from "../ports";
import { TOKENS } from "../tokens";

/** WhatsApp accepts JPEG and PNG images up to 5 MB; WebP and GIF are accepted here for web chat and converted by nobody, so keep to what Meta takes. */
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const UploadSchema = z.object({
  /** data:image/jpeg;base64,... as a browser's FileReader produces it. */
  dataUrl: z.string().min(30).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64),
});

/** The public URL of an uploaded image, where WhatsApp and browsers fetch it. */
export function mediaUrl(config: Pick<AppConfig, "PUBLIC_BASE_URL">, id: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/v1/media/${encodeURIComponent(id)}`;
}

/** Catalog and property photos: staff upload them from the dashboard, customers (and Meta) fetch them by id. */
@Controller()
export class MediaController {
  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.MediaRepository) private readonly media: MediaRepository,
  ) {}

  @Post("merchant/media")
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async upload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = UploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("dataUrl (a base64 data: URL of a JPEG or PNG) is required");
    const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/is.exec(parsed.data.dataUrl);
    if (!m) throw new BadRequestException("dataUrl must be a base64 data: URL");
    const mimeType = m[1]!.toLowerCase();
    if (!IMAGE_TYPES.has(mimeType)) throw new BadRequestException("only JPEG and PNG images are accepted");
    const data = Buffer.from(m[2]!, "base64");
    if (data.byteLength === 0) throw new BadRequestException("empty image");
    if (data.byteLength > MAX_IMAGE_BYTES) throw new PayloadTooLargeException("images must be 5 MB or smaller");
    const saved = await this.media.save({ tenantId: user.tenantId, mimeType, data });
    return { id: saved.id, url: mediaUrl(this.config, saved.id), mimeType: saved.mimeType, sizeBytes: saved.sizeBytes };
  }

  /** Public and cacheable forever: ids are random and a new upload gets a new id. */
  @Get("v1/media/:id")
  async serve(@Param("id") id: string, @Res() res: Response) {
    const asset = await this.media.get(id);
    if (!asset) throw new NotFoundException("no such image");
    res.setHeader("content-type", asset.mimeType);
    res.setHeader("content-length", String(asset.sizeBytes));
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.send(asset.data);
  }
}
