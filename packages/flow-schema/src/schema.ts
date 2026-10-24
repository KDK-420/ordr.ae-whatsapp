import { StateMachineSchema } from "@ordr/domain";
import { z } from "zod";

/** Copy is either a plain string or a map of language code to string. */
export const I18nTextSchema = z.union([z.string(), z.record(z.string(), z.string())]);
export type I18nText = z.infer<typeof I18nTextSchema>;

export const OptionSchema = z.object({
  id: z.string().min(1).max(200),
  title: I18nTextSchema,
  description: I18nTextSchema.optional(),
  /** Node to jump to when this option is chosen. Falls back to the question's `next`. */
  next: z.string().optional(),
});
export type Option = z.infer<typeof OptionSchema>;

/** Shape expected for rows supplied dynamically through `rowsFrom`. */
export const DynamicRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
export type DynamicRow = z.infer<typeof DynamicRowSchema>;

export const QuestionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buttons"), options: z.array(OptionSchema).min(1).max(3) }),
  z.object({
    kind: z.literal("list"),
    button: I18nTextSchema,
    sections: z
      .array(z.object({ title: I18nTextSchema.optional(), rows: z.array(OptionSchema).min(1) }))
      .min(1)
      .optional(),
    /** Context path holding DynamicRow[]; used instead of `sections` for data-driven lists. */
    rowsFrom: z.string().optional(),
    /** Where to go when `rowsFrom` resolves to an empty array. */
    onEmpty: z.string().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    pattern: z.string().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  }),
  z.object({ kind: z.literal("location") }),
]);
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

const base = { id: z.string().min(1), next: z.string().optional() };

/** Shape expected for photos supplied through an `images` node's `from` path. */
export const ImageRowSchema = z.object({ link: z.string().url(), caption: z.string().max(1024).optional() });
export type ImageRow = z.infer<typeof ImageRowSchema>;

export const NodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("message"), text: I18nTextSchema }),
  z.object({
    ...base,
    type: z.literal("images"),
    /** Context path holding ImageRow[] (public https links with optional captions); each becomes an image message. */
    from: z.string().min(1),
    /** Said instead when the path holds no photos. */
    emptyText: I18nTextSchema.optional(),
    /** At most this many photos per turn (WhatsApp delivers them one by one). */
    max: z.number().int().min(1).max(10).default(6),
  }),
  z.object({
    ...base,
    type: z.literal("question"),
    /** Context key the answer is stored under. */
    var: z.string().min(1),
    prompt: I18nTextSchema,
    input: QuestionInputSchema,
    invalidText: I18nTextSchema.optional(),
    maxRetries: z.number().int().min(0).default(2),
    /** Node to go to after too many invalid answers. Defaults to ending the flow. */
    onFail: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("action"),
    action: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
    saveAs: z.string().optional(),
    onError: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("branch"),
    cases: z
      .array(
        z.object({
          var: z.string().min(1),
          eq: z.unknown().optional(),
          in: z.array(z.unknown()).optional(),
          exists: z.boolean().optional(),
          next: z.string().min(1),
        }),
      )
      .min(1),
    default: z.string().optional(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("goto_flow"), flow: z.string().min(1) }),
  z.object({ id: z.string().min(1), type: z.literal("handoff"), text: I18nTextSchema.optional() }),
  z.object({ id: z.string().min(1), type: z.literal("end"), text: I18nTextSchema.optional() }),
]);
export type FlowNode = z.infer<typeof NodeSchema>;
export type QuestionNode = Extract<FlowNode, { type: "question" }>;

export const FlowDefinitionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    entry: z.string().min(1),
    nodes: z.array(NodeSchema).min(1),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    for (const n of flow.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `duplicate node id "${n.id}"`, path: ["nodes"] });
      ids.add(n.id);
    }
    const ref = (target: string | undefined, where: string) => {
      if (target && !ids.has(target)) {
        ctx.addIssue({ code: "custom", message: `${where} references unknown node "${target}"`, path: ["nodes"] });
      }
    };
    ref(flow.entry, "entry");
    for (const n of flow.nodes) {
      if ("next" in n) ref(n.next, `node "${n.id}".next`);
      if (n.type === "question") {
        ref(n.onFail, `node "${n.id}".onFail`);
        if (n.input.kind === "buttons") for (const o of n.input.options) ref(o.next, `option "${o.id}"`);
        if (n.input.kind === "list") {
          ref(n.input.onEmpty, `node "${n.id}".onEmpty`);
          for (const s of n.input.sections ?? []) for (const o of s.rows) ref(o.next, `row "${o.id}"`);
          if (!n.input.sections && !n.input.rowsFrom) {
            ctx.addIssue({ code: "custom", message: `list question "${n.id}" needs sections or rowsFrom`, path: ["nodes"] });
          }
        }
      }
      if (n.type === "action") ref(n.onError, `node "${n.id}".onError`);
      if (n.type === "branch") {
        for (const c of n.cases) ref(c.next, `branch "${n.id}" case`);
        ref(n.default, `branch "${n.id}".default`);
      }
    }
  });
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

export const GlobalCommandSchema = z.object({
  /** Case-insensitive keywords that trigger this flow from any state. */
  keywords: z.array(z.string().min(1)).min(1),
  flow: z.string().min(1),
});

export const BlueprintSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    defaultLanguage: z.string().min(2),
    languages: z.array(z.string().min(2)).min(1),
    offeringType: z.enum(["product", "service", "stay"]),
    fulfillmentTypes: z.array(z.string().min(1)).min(1),
    orderStates: StateMachineSchema,
    entryFlow: z.string().min(1),
    /** Flow to run when a session has expired or the customer writes something unrecognized. */
    fallbackFlow: z.string().optional(),
    globalCommands: z.array(GlobalCommandSchema).default([]),
    flows: z.array(FlowDefinitionSchema).min(1),
    dashboardModules: z.array(z.string()).default([]),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((bp, ctx) => {
    const flowIds = new Set(bp.flows.map((f) => f.id));
    const ref = (id: string | undefined, where: string) => {
      if (id && !flowIds.has(id)) ctx.addIssue({ code: "custom", message: `${where} references unknown flow "${id}"` });
    };
    ref(bp.entryFlow, "entryFlow");
    ref(bp.fallbackFlow, "fallbackFlow");
    for (const g of bp.globalCommands) ref(g.flow, `global command "${g.keywords[0]}"`);
    for (const f of bp.flows) for (const n of f.nodes) if (n.type === "goto_flow") ref(n.flow, `node "${f.id}.${n.id}"`);
    if (!bp.languages.includes(bp.defaultLanguage)) {
      ctx.addIssue({ code: "custom", message: `defaultLanguage "${bp.defaultLanguage}" is not in languages` });
    }
  });
export type Blueprint = z.infer<typeof BlueprintSchema>;
export type BlueprintInput = z.input<typeof BlueprintSchema>;

export class BlueprintValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super("Invalid blueprint:\n" + issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`).join("\n"));
    this.name = "BlueprintValidationError";
  }
}

export function parseBlueprint(input: unknown): Blueprint {
  const result = BlueprintSchema.safeParse(input);
  if (result.success) return result.data;
  throw new BlueprintValidationError(
    result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  );
}
