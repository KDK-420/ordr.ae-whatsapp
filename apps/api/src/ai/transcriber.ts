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

/**
 * The provider behind TRANSCRIPTION_PROVIDER. Only "none" ships today; a real adapter (Deepgram,
 * OpenAI Whisper, Google Speech) implements Transcriber and gets a case here, with its key read
 * from TRANSCRIPTION_API_KEY.
 */
export function createTranscriber(config: { TRANSCRIPTION_PROVIDER: "none"; TRANSCRIPTION_API_KEY?: string }): Transcriber {
  switch (config.TRANSCRIPTION_PROVIDER) {
    case "none":
      return new NoopTranscriber();
  }
}
