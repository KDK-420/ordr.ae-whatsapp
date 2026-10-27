/**
 * Outbound message payloads (the "message" part of a Cloud API send request) plus builders
 * that enforce Meta's limits so bad copy fails at build time rather than at Meta.
 */

export const LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  interactiveFooter: 60,
  headerText: 60,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listSections: 10,
  listRows: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
} as const;

/** Quotes an earlier message in the thread (WhatsApp shows it above the reply). */
export interface ReplyContext {
  message_id: string;
}

export interface TextMessage {
  type: "text";
  text: { body: string; preview_url?: boolean };
  context?: ReplyContext;
}

export interface ReplyButton {
  type: "reply";
  reply: { id: string; title: string };
}

export interface InteractiveButtonsMessage {
  type: "interactive";
  interactive: {
    type: "button";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: { buttons: ReplyButton[] };
  };
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

export interface InteractiveListMessage {
  type: "interactive";
  interactive: {
    type: "list";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: { button: string; sections: ListSection[] };
  };
}

export interface LocationRequestMessage {
  type: "interactive";
  interactive: {
    type: "location_request_message";
    body: { text: string };
    action: { name: "send_location" };
  };
}

export interface TemplateMessage {
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: Array<Record<string, unknown>>;
  };
}

export interface ImageMessage {
  type: "image";
  image: { link?: string; id?: string; caption?: string };
  context?: ReplyContext;
}

export type OutboundMessage =
  | TextMessage
  | InteractiveButtonsMessage
  | InteractiveListMessage
  | LocationRequestMessage
  | TemplateMessage
  | ImageMessage;

export class MessageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageLimitError";
  }
}

function assertMax(value: string, max: number, what: string): void {
  if (value.length > max) throw new MessageLimitError(`${what} exceeds ${max} characters: "${value.slice(0, 30)}..."`);
}

function assertNotEmpty(value: string, what: string): void {
  if (!value.trim()) throw new MessageLimitError(`${what} must not be empty`);
}

/** Cuts a string to a limit without exceeding it. Use for dynamic data such as catalog titles. */
export function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function text(body: string, opts: { previewUrl?: boolean; replyTo?: string } = {}): TextMessage {
  assertNotEmpty(body, "text body");
  assertMax(body, LIMITS.textBody, "text body");
  const msg: TextMessage = { type: "text", text: { body, preview_url: opts.previewUrl ?? false } };
  if (opts.replyTo) msg.context = { message_id: opts.replyTo };
  return msg;
}

export function buttons(
  body: string,
  options: Array<{ id: string; title: string }>,
  opts: { header?: string; footer?: string } = {},
): InteractiveButtonsMessage {
  assertNotEmpty(body, "body");
  assertMax(body, LIMITS.interactiveBody, "body");
  if (options.length === 0 || options.length > LIMITS.buttons) {
    throw new MessageLimitError(`buttons message needs 1 to ${LIMITS.buttons} buttons, got ${options.length}`);
  }
  for (const o of options) {
    assertNotEmpty(o.title, "button title");
    assertMax(o.title, LIMITS.buttonTitle, "button title");
  }
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length) throw new MessageLimitError("button ids must be unique");
  const msg: InteractiveButtonsMessage = {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: options.map((o) => ({ type: "reply", reply: { id: o.id, title: o.title } })) },
    },
  };
  if (opts.header) {
    assertMax(opts.header, LIMITS.headerText, "header");
    msg.interactive.header = { type: "text", text: opts.header };
  }
  if (opts.footer) {
    assertMax(opts.footer, LIMITS.interactiveFooter, "footer");
    msg.interactive.footer = { text: opts.footer };
  }
  return msg;
}

export function list(
  body: string,
  buttonText: string,
  sections: ListSection[],
  opts: { header?: string; footer?: string } = {},
): InteractiveListMessage {
  assertNotEmpty(body, "body");
  assertMax(body, LIMITS.interactiveBody, "body");
  assertNotEmpty(buttonText, "list button");
  assertMax(buttonText, LIMITS.listButton, "list button");
  if (sections.length === 0 || sections.length > LIMITS.listSections) {
    throw new MessageLimitError(`list needs 1 to ${LIMITS.listSections} sections, got ${sections.length}`);
  }
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows === 0 || totalRows > LIMITS.listRows) {
    throw new MessageLimitError(`list needs 1 to ${LIMITS.listRows} rows in total, got ${totalRows}`);
  }
  const ids = new Set<string>();
  for (const s of sections) {
    if (s.title) assertMax(s.title, LIMITS.sectionTitle, "section title");
    for (const r of s.rows) {
      assertNotEmpty(r.title, "row title");
      assertMax(r.title, LIMITS.rowTitle, "row title");
      assertMax(r.id, LIMITS.rowId, "row id");
      if (r.description) assertMax(r.description, LIMITS.rowDescription, "row description");
      if (ids.has(r.id)) throw new MessageLimitError(`duplicate row id "${r.id}"`);
      ids.add(r.id);
    }
  }
  const msg: InteractiveListMessage = {
    type: "interactive",
    interactive: { type: "list", body: { text: body }, action: { button: buttonText, sections } },
  };
  if (opts.header) {
    assertMax(opts.header, LIMITS.headerText, "header");
    msg.interactive.header = { type: "text", text: opts.header };
  }
  if (opts.footer) {
    assertMax(opts.footer, LIMITS.interactiveFooter, "footer");
    msg.interactive.footer = { text: opts.footer };
  }
  return msg;
}

export function locationRequest(body: string): LocationRequestMessage {
  assertNotEmpty(body, "body");
  assertMax(body, LIMITS.interactiveBody, "body");
  return {
    type: "interactive",
    interactive: { type: "location_request_message", body: { text: body }, action: { name: "send_location" } },
  };
}

export function template(name: string, languageCode: string, components?: Array<Record<string, unknown>>): TemplateMessage {
  assertNotEmpty(name, "template name");
  return { type: "template", template: { name, language: { code: languageCode }, components } };
}

export function image(source: { link: string } | { id: string }, caption?: string): ImageMessage {
  return { type: "image", image: { ...source, caption } };
}
