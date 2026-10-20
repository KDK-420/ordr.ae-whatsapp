"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "@/lib/marketing";

/** A WhatsApp-looking phone that plays a conversation line by line, then loops. */
export function ChatDemo({ lines, title }: { lines: ChatLine[]; title: string }) {
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      if (cancelled) return;
      if (i >= lines.length) {
        timer = setTimeout(() => {
          setShown(0);
          setTyping(false);
          step(0);
        }, 4000);
        return;
      }
      const line = lines[i]!;
      const wait = line.delay ?? 1200;
      if (line.from === "bot") setTyping(true);
      timer = setTimeout(() => {
        setTyping(false);
        setShown(i + 1);
        step(i + 1);
      }, wait);
    };
    step(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lines]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [shown, typing]);

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[2rem] border-[6px] border-slate-900 bg-[#e5ddd5] shadow-2xl" aria-label="Example conversation">
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">{title.slice(0, 1)}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-white/80">{typing ? "typing…" : "online"}</div>
        </div>
      </div>
      <div ref={scroller} className="h-[380px] space-y-2 overflow-y-auto px-3 py-3">
        {lines.slice(0, shown).map((l, i) => (
          <div key={`${i}-${l.text}`} className={`flex ${l.from === "customer" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] rounded-lg px-3 py-1.5 text-[13px] leading-snug shadow-sm ${l.from === "customer" ? "rounded-tr-none bg-[#dcf8c6] text-slate-900" : "rounded-tl-none bg-white text-slate-900"}`}>{l.text}</div>
          </div>
        ))}
        {typing ? (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 bg-[#f0f0f0] px-3 py-2">
        <div className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs text-slate-400">Type a message</div>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#128c7e] text-[10px] text-white">➤</div>
      </div>
    </div>
  );
}
