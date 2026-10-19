import { clip, LIMITS, type InboundContent, type OutboundMessage, buttons, list, locationRequest, text } from "@ordr/whatsapp";
import { z } from "zod";
import { type Blueprint, type DynamicRow, DynamicRowSchema, type FlowDefinition, type FlowNode, type Option, type QuestionNode } from "./schema";
import { getPath, interpolate, interpolateDeep, resolveText } from "./text";

export interface SessionState {
  flowId: string;
  /** Node the session is parked at (always a question while awaiting). */
  nodeId: string;
  awaiting: boolean;
  retries: number;
  language: string;
  context: Record<string, unknown>;
  updatedAt: string;
}

export interface ActionContext {
  tenantId: string;
  customer: { id?: string; waId: string; name?: string };
  conversationId?: string;
  language: string;
  context: Record<string, unknown>;
}

export type ActionHandler = (params: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;

export interface ActionRegistry {
  get(name: string): ActionHandler | undefined;
}

export class MapActionRegistry implements ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();
  register(name: string, handler: ActionHandler): this {
    this.handlers.set(name, handler);
    return this;
  }
  get(name: string): ActionHandler | undefined {
    return this.handlers.get(name);
  }
}

export interface RunResult {
  outbound: OutboundMessage[];
  /** Null when the flow finished or handed off. */
  session: SessionState | null;
  handoff: boolean;
  completed: boolean;
}

export class FlowRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowRunnerError";
  }
}

interface Frame {
  flow: FlowDefinition;
  node: FlowNode;
}

const DEFAULT_INVALID: Record<string, string> = {
  en: "Sorry, I did not understand that. Please choose one of the options.",
  ar: "عذراً، لم أفهم ذلك. يرجى اختيار أحد الخيارات.",
};

const DEFAULT_FAIL: Record<string, string> = {
  en: "Let us start over. Send \"menu\" any time to see the options.",
  ar: "لنبدأ من جديد. أرسل \"القائمة\" في أي وقت لعرض الخيارات.",
};

/**
 * Executes blueprint flows. The runner is stateless; everything it needs between turns lives in
 * SessionState, which the caller persists.
 */
export class FlowRunner {
  private readonly flows: Map<string, FlowDefinition>;
  private readonly maxSteps: number;

  constructor(
    private readonly blueprint: Blueprint,
    private readonly actions: ActionRegistry,
    opts: { maxSteps?: number } = {},
  ) {
    this.flows = new Map(blueprint.flows.map((f) => [f.id, f]));
    this.maxSteps = opts.maxSteps ?? 50;
  }

  /** Returns the flow id a message should jump to, if it matches a global command. */
  matchGlobalCommand(input: InboundContent): string | undefined {
    if (input.kind !== "text") return undefined;
    const needle = input.text.trim().toLowerCase();
    if (!needle) return undefined;
    for (const g of this.blueprint.globalCommands) {
      if (g.keywords.some((k) => k.toLowerCase() === needle)) return g.flow;
    }
    return undefined;
  }

  async start(flowId: string, init: { language: string; context?: Record<string, unknown> }, actionCtx: Omit<ActionContext, "language" | "context">): Promise<RunResult> {
    const flow = this.getFlow(flowId);
    const session: SessionState = {
      flowId,
      nodeId: flow.entry,
      awaiting: false,
      retries: 0,
      language: init.language,
      context: { ...(init.context ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    return this.run(session, flow, this.getNode(flow, flow.entry), [], actionCtx);
  }

  /**
   * The choices the parked question is waiting for (buttons or list rows), for an assistant that maps
   * free text onto one of them. Null when the session is not waiting or the question takes free text.
   */
  pendingOptions(session: SessionState): { prompt: string; kind: "button" | "list"; options: DynamicRow[] } | null {
    if (!session.awaiting) return null;
    const node = this.getNode(this.getFlow(session.flowId), session.nodeId);
    if (node.type !== "question") return null;
    const prompt = this.t(node.prompt, session);
    if (node.input.kind === "buttons") return { prompt, kind: "button", options: node.input.options.map((o) => this.toRow(o, session)) };
    if (node.input.kind === "list") return { prompt, kind: "list", options: this.listRows(node, session) };
    return null;
  }

  /** Whether `resume` would accept this input as an answer, without changing the session. */
  accepts(session: SessionState, input: InboundContent): boolean {
    if (!session.awaiting) return false;
    const node = this.getNode(this.getFlow(session.flowId), session.nodeId);
    if (node.type !== "question") return false;
    return this.matchAnswer(node, input, session).ok;
  }

  async resume(session: SessionState, input: InboundContent, actionCtx: Omit<ActionContext, "language" | "context">): Promise<RunResult> {
    const flow = this.getFlow(session.flowId);
    const node = this.getNode(flow, session.nodeId);
    if (!session.awaiting || node.type !== "question") {
      throw new FlowRunnerError(`session is not awaiting input at "${session.flowId}.${session.nodeId}"`);
    }
    const outbound: OutboundMessage[] = [];
    const answer = this.matchAnswer(node, input, session);

    if (answer.ok) {
      session.context[node.var] = answer.value;
      session.retries = 0;
      session.awaiting = false;
      const nextId = answer.next ?? node.next;
      if (!nextId) return this.finish(session, outbound);
      return this.run(session, flow, this.getNode(flow, nextId), outbound, actionCtx);
    }

    session.retries += 1;
    if (session.retries > node.maxRetries) {
      session.retries = 0;
      session.awaiting = false;
      if (node.onFail) return this.run(session, flow, this.getNode(flow, node.onFail), outbound, actionCtx);
      outbound.push(text(this.t(DEFAULT_FAIL, session)));
      return this.finish(session, outbound);
    }
    outbound.push(text(this.t(node.invalidText ?? DEFAULT_INVALID, session)));
    const rendered = this.renderQuestion(node, session);
    if (rendered.message) outbound.push(rendered.message);
    session.updatedAt = new Date().toISOString();
    return { outbound, session, handoff: false, completed: false };
  }

  private async run(
    session: SessionState,
    startFlow: FlowDefinition,
    startNode: FlowNode,
    outbound: OutboundMessage[],
    actionCtx: Omit<ActionContext, "language" | "context">,
  ): Promise<RunResult> {
    let frame: Frame = { flow: startFlow, node: startNode };
    for (let steps = 0; steps < this.maxSteps; steps++) {
      const { flow, node } = frame;
      session.flowId = flow.id;
      session.nodeId = node.id;

      switch (node.type) {
        case "message": {
          outbound.push(text(this.t(node.text, session)));
          const next = this.advance(flow, node.next);
          if (!next) return this.finish(session, outbound);
          frame = next;
          break;
        }
        case "question": {
          const rendered = this.renderQuestion(node, session);
          if (!rendered.message) {
            // Dynamic list with no rows.
            const target = node.input.kind === "list" ? node.input.onEmpty : undefined;
            const next = this.advance(flow, target);
            if (!next) return this.finish(session, outbound);
            frame = next;
            break;
          }
          outbound.push(rendered.message);
          session.awaiting = true;
          session.retries = 0;
          session.updatedAt = new Date().toISOString();
          return { outbound, session, handoff: false, completed: false };
        }
        case "action": {
          let nextId = node.next;
          try {
            const result = await this.runAction(node.action, node.params, session, actionCtx);
            if (node.saveAs) session.context[node.saveAs] = result;
          } catch (err) {
            if (!node.onError) throw err;
            session.context.lastError = err instanceof Error ? err.message : String(err);
            nextId = node.onError;
          }
          const next = this.advance(flow, nextId);
          if (!next) return this.finish(session, outbound);
          frame = next;
          break;
        }
        case "branch": {
          const target = this.evaluateBranch(node, session.context);
          const next = this.advance(flow, target);
          if (!next) return this.finish(session, outbound);
          frame = next;
          break;
        }
        case "goto_flow": {
          const target = this.getFlow(node.flow);
          frame = { flow: target, node: this.getNode(target, target.entry) };
          break;
        }
        case "handoff": {
          if (node.text) outbound.push(text(this.t(node.text, session)));
          return { outbound, session: null, handoff: true, completed: false };
        }
        case "end": {
          if (node.text) outbound.push(text(this.t(node.text, session)));
          return this.finish(session, outbound);
        }
      }
    }
    throw new FlowRunnerError(`flow "${session.flowId}" exceeded ${this.maxSteps} steps without waiting for input`);
  }

  private finish(_session: SessionState, outbound: OutboundMessage[]): RunResult {
    return { outbound, session: null, handoff: false, completed: true };
  }

  private advance(flow: FlowDefinition, nextId: string | undefined): Frame | null {
    if (!nextId) return null;
    return { flow, node: this.getNode(flow, nextId) };
  }

  private async runAction(
    name: string,
    params: Record<string, unknown>,
    session: SessionState,
    actionCtx: Omit<ActionContext, "language" | "context">,
  ): Promise<unknown> {
    const resolvedParams = interpolateDeep(params, session.context);
    if (name === "system.set_language") {
      const lang = String(resolvedParams.language ?? "");
      if (!this.blueprint.languages.includes(lang)) throw new FlowRunnerError(`unsupported language "${lang}"`);
      session.language = lang;
      return lang;
    }
    const handler = this.actions.get(name);
    if (!handler) throw new FlowRunnerError(`no handler registered for action "${name}"`);
    return handler(resolvedParams, { ...actionCtx, language: session.language, context: session.context });
  }

  private evaluateBranch(node: Extract<FlowNode, { type: "branch" }>, context: Record<string, unknown>): string | undefined {
    for (const c of node.cases) {
      const v = getPath(context, c.var);
      if (c.exists !== undefined && (v !== undefined && v !== null) !== c.exists) continue;
      if (c.eq !== undefined && v !== c.eq) continue;
      if (c.in !== undefined && !c.in.includes(v)) continue;
      return c.next;
    }
    return node.default;
  }

  private renderQuestion(node: QuestionNode, session: SessionState): { message: OutboundMessage | null; rows?: DynamicRow[] } {
    const prompt = this.t(node.prompt, session);
    switch (node.input.kind) {
      case "buttons":
        return {
          message: buttons(
            prompt,
            node.input.options.map((o) => ({ id: o.id, title: clip(this.t(o.title, session), LIMITS.buttonTitle) })),
          ),
        };
      case "list": {
        const rows = this.listRows(node, session);
        if (rows.length === 0) return { message: null };
        const button = clip(this.t(node.input.button, session), LIMITS.listButton);
        if (node.input.sections) {
          const sections = node.input.sections.map((s) => ({
            title: s.title ? clip(this.t(s.title, session), LIMITS.sectionTitle) : undefined,
            rows: s.rows.map((r) => this.toRow(r, session)),
          }));
          return { message: list(prompt, button, sections) };
        }
        return { message: list(prompt, button, [{ rows }]), rows };
      }
      case "text":
        return { message: text(prompt) };
      case "location":
        return { message: locationRequest(prompt) };
    }
  }

  private toRow(o: Option, session: SessionState): DynamicRow {
    const description = o.description ? clip(this.t(o.description, session), LIMITS.rowDescription) : undefined;
    return { id: o.id, title: clip(this.t(o.title, session), LIMITS.rowTitle), description };
  }

  /** All selectable rows for a list question, static or dynamic, clipped to Meta's limits. */
  private listRows(node: QuestionNode, session: SessionState): DynamicRow[] {
    if (node.input.kind !== "list") return [];
    if (node.input.sections) return node.input.sections.flatMap((s) => s.rows.map((r) => this.toRow(r, session)));
    const raw = getPath(session.context, node.input.rowsFrom ?? "");
    const parsed = z.array(DynamicRowSchema).safeParse(raw ?? []);
    if (!parsed.success) {
      throw new FlowRunnerError(`rowsFrom "${node.input.rowsFrom}" in "${node.id}" does not hold DynamicRow[]`);
    }
    return parsed.data.slice(0, LIMITS.listRows).map((r) => ({
      id: r.id,
      title: clip(r.title, LIMITS.rowTitle),
      description: r.description ? clip(r.description, LIMITS.rowDescription) : undefined,
    }));
  }

  private matchAnswer(
    node: QuestionNode,
    input: InboundContent,
    session: SessionState,
  ): { ok: true; value: unknown; next?: string } | { ok: false } {
    const input_ = node.input;
    switch (input_.kind) {
      case "buttons": {
        const options = input_.options;
        const picked = pickOption(options, input, (o) => this.t(o.title, session));
        if (!picked) return { ok: false };
        return { ok: true, value: { id: picked.id, title: this.t(picked.title, session) }, next: picked.next };
      }
      case "list": {
        const staticRows = input_.sections?.flatMap((s) => s.rows);
        if (staticRows) {
          const picked = pickOption(staticRows, input, (o) => this.t(o.title, session));
          if (!picked) return { ok: false };
          return { ok: true, value: { id: picked.id, title: this.t(picked.title, session) }, next: picked.next };
        }
        const rows = this.listRows(node, session);
        const picked = pickOption(rows, input, (r) => r.title);
        if (!picked) return { ok: false };
        return { ok: true, value: { id: picked.id, title: picked.title } };
      }
      case "text": {
        if (input.kind !== "text") return { ok: false };
        const v = input.text.trim();
        if (input_.minLength !== undefined && v.length < input_.minLength) return { ok: false };
        if (input_.maxLength !== undefined && v.length > input_.maxLength) return { ok: false };
        if (input_.pattern && !new RegExp(input_.pattern).test(v)) return { ok: false };
        return { ok: true, value: v };
      }
      case "location": {
        if (input.kind !== "location") return { ok: false };
        const { latitude, longitude, name, address } = input;
        return { ok: true, value: { latitude, longitude, name, address } };
      }
    }
  }

  private t(copy: Parameters<typeof resolveText>[0], session: SessionState): string {
    return interpolate(resolveText(copy, session.language, this.blueprint.defaultLanguage), session.context);
  }

  private getFlow(id: string): FlowDefinition {
    const f = this.flows.get(id);
    if (!f) throw new FlowRunnerError(`unknown flow "${id}"`);
    return f;
  }

  private getNode(flow: FlowDefinition, id: string): FlowNode {
    const n = flow.nodes.find((x) => x.id === id);
    if (!n) throw new FlowRunnerError(`unknown node "${id}" in flow "${flow.id}"`);
    return n;
  }
}

/**
 * Matches an interactive reply by id, or a typed message by 1-based position or by title.
 * Typing "2" or "Burgers" works as well as tapping, which matters for customers on old clients.
 */
function pickOption<T extends { id: string }>(options: T[], input: InboundContent, titleOf: (o: T) => string): T | undefined {
  if (input.kind === "button" || input.kind === "list") return options.find((o) => o.id === input.id);
  if (input.kind !== "text") return undefined;
  const typed = input.text.trim().toLowerCase();
  if (!typed) return undefined;
  const asIndex = Number(typed);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= options.length) return options[asIndex - 1];
  return options.find((o) => titleOf(o).trim().toLowerCase() === typed || o.id.toLowerCase() === typed);
}
