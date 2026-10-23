import type { ReactNode } from "react";

/**
 * Renders WhatsApp's text markup the way the WhatsApp app does: *bold*, _italic_, ~strikethrough~,
 * `monospace`, and lines that start with "- " or "* " as bullets. Everything else is plain text,
 * so a stray asterisk never breaks a message. Links are left to the caller.
 */
export function waFormat(text: string, keyPrefix = "wa"): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`${keyPrefix}-ul-${out.length}`} className="my-1 list-disc space-y-0.5 ps-5">
        {bullets}
      </ul>,
    );
    bullets = [];
  };
  let afterList = false;
  lines.forEach((line, i) => {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      // A blank line before the list would double up with the list's own block spacing.
      if (!bullets.length && out.at(-1) === "\n") out.pop();
      bullets.push(<li key={`${keyPrefix}-li-${i}`}>{inline(bullet[1]!, `${keyPrefix}-${i}`)}</li>);
      return;
    }
    if (bullets.length) {
      flush();
      afterList = true;
    }
    if (afterList) {
      // The list is a block already: skip blank lines and the break that would follow it.
      if (line.trim() === "") return;
      afterList = false;
    } else if (i > 0) {
      out.push("\n");
    }
    out.push(...inline(line, `${keyPrefix}-${i}`));
  });
  flush();
  return out;
}

const TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;

function inline(line: string, keyPrefix: string): ReactNode[] {
  const parts = line.split(TOKEN).filter((p) => p !== "");
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const m = part.length > 2 ? part : "";
    if (m.startsWith("*") && m.endsWith("*")) return <strong key={key}>{m.slice(1, -1)}</strong>;
    if (m.startsWith("_") && m.endsWith("_")) return <em key={key}>{m.slice(1, -1)}</em>;
    if (m.startsWith("~") && m.endsWith("~")) return <s key={key}>{m.slice(1, -1)}</s>;
    if (m.startsWith("`") && m.endsWith("`")) return <code key={key} className="rounded bg-black/5 px-1 font-mono text-[0.9em]">{m.slice(1, -1)}</code>;
    return part;
  });
}
