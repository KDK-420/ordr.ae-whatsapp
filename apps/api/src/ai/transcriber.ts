/**
 * Speech to text for voice notes. Claude's API takes text, images and PDFs but no audio
 * (checked against @anthropic-ai/sdk 0.135.0: no audio content block exists), so a voice note
 * is transcribed here before the agent sees it. Without a provider the note reaches the agent
 * as "[sent a voice note]" and the agent asks the customer to type it.
 */

export interface TranscribeInput {
  data: Buffer;
  /** As reported by WhatsApp, usually audio/ogg; codecs=opus. */
  mimeType: string;
  /** Hint only: the customer's language so far (en, ar). */
  language?: string;
}

export interface Transcriber {
  readonly enabled: boolean;
  /** The words spoken, or null when nothing intelligible was found. Throws on provider errors. */
  transcribe(input: TranscribeInput): Promise<string | null>;
}

/** Used when TRANSCRIPTION_PROVIDER is "none": voice notes are described, not transcribed. */
export class NoopTranscriber implements Transcriber {
  readonly enabled = false;
  async transcribe(): Promise<string | null> {
    return null;
  }
}

/** Records what it was asked to transcribe and answers from a script. Tests only. */
export class FakeTranscriber implements Transcriber {
  readonly enabled = true;
  readonly calls: TranscribeInput[] = [];
  constructor(public next: string | null | Error = null) {}
  async transcribe(input: TranscribeInput): Promise<string | null> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export interface OpenAiTranscriberOptions {
  apiKey: string;
  /** gpt-4o-mini-transcribe by default; gpt-4o-transcribe or whisper-1 also work on the same endpoint. */
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenAI's speech-to-text endpoint. One multipart POST per voice note; WhatsApp's audio/ogg (opus)
 * is accepted as is. The language hint narrows the model's guess when the customer has already
 * written in Arabic or English.
 */
export class OpenAiTranscriber implements Transcriber {
  readonly enabled = true;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAiTranscriberOptions) {
    this.model = opts.model ?? "gpt-4o-mini-transcribe";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async transcribe(input: TranscribeInput): Promise<string | null> {
    const form = new FormData();
    const mimeType = input.mimeType.split(";")[0]!.trim() || "audio/ogg";
    form.append("file", new Blob([new Uint8Array(input.data)], { type: mimeType }), `voice.${extensionFor(mimeType)}`);
    form.append("model", this.model);
    form.append("response_format", "json");
    if (input.language && /^[a-z]{2}$/i.test(input.language)) form.append("language", input.language.toLowerCase());
    const res = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: { message?: string } };
    if (!res.ok) throw new Error(`transcription failed (${res.status}): ${body.error?.message ?? "unknown error"}`);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    return text ? text : null;
  }
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/amr":
      return "amr";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return "ogg";
  }
}

export interface TranscriberConfig {
  TRANSCRIPTION_PROVIDER: "none" | "openai";
  TRANSCRIPTION_API_KEY?: string;
  TRANSCRIPTION_MODEL?: string;
}

/** The provider behind TRANSCRIPTION_PROVIDER. "openai" needs TRANSCRIPTION_API_KEY; the app refuses to start without it. */
export function createTranscriber(config: TranscriberConfig): Transcriber {
  switch (config.TRANSCRIPTION_PROVIDER) {
    case "none":
      return new NoopTranscriber();
    case "openai":
      if (!config.TRANSCRIPTION_API_KEY) throw new Error("TRANSCRIPTION_PROVIDER=openai needs TRANSCRIPTION_API_KEY");
      return new OpenAiTranscriber({ apiKey: config.TRANSCRIPTION_API_KEY, model: config.TRANSCRIPTION_MODEL });
  }
}
