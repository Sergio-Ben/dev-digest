"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/utils/githubUrls";
import type { SymbolRow } from "./helpers";

interface SymbolListProps {
  rows: SymbolRow[];
  /** Which symbol is expanded, or null for all-collapsed. Owned by the card:
   *  the Tree/Graph toggle unmounts this component, so local state here would
   *  reset the tree to the first symbol on every round trip to the graph. */
  openSymbol: string | null;
  onToggleSymbol: (name: string) => void;
  /** Paths this PR touches — a caller inside the diff has a local line to open. */
  changedPaths: Set<string>;
  repoFullName: string | null;
  headSha: string | null | undefined;
  onOpenFileLine: (file: string, line: number) => void;
}

export function SymbolList({
  rows,
  openSymbol,
  onToggleSymbol,
  changedPaths,
  repoFullName,
  headSha,
  onOpenFileLine,
}: SymbolListProps) {
  const t = useTranslations("prReview.blastRadius");

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col">
      {rows.map((sym, i) => {
        const isOpen = openSymbol === sym.name;
        const Chevron = isOpen ? Icon.ChevronDown : Icon.ChevronRight;
        return (
          <div
            key={sym.name}
            className={i > 0 ? "border-t border-[var(--border)]" : ""}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onToggleSymbol(sym.name)}
              className="bg-transparent border-none cursor-pointer px-0 py-2 w-full flex items-center gap-2 text-left"
            >
              <Chevron
                size={12}
                className="shrink-0 text-[var(--text-muted)]"
              />
              <Icon.Code size={12} className="shrink-0 text-[var(--accent-text)]" />
              <span className="min-w-0 font-mono text-[13px] text-[var(--text-primary)] font-semibold truncate">
                {sym.name}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">
                {t("callersCount", { count: sym.callers.length })}
              </span>
            </button>

            {isOpen && (
              // Guide rail: the vertical border is the tree line the callers
              // hang off, aligned under the chevron above.
              <div className="ml-[5px] border-l border-[var(--border)] pl-2 pb-2.5 flex flex-col">
                {/* No empty-callers branch: `buildSymbolRows` drops those rows,
                    so every row here has at least one caller. */}
                {sym.callers.map((c) => {
                  // A caller is by definition a file that USES the changed
                  // symbol, so it is usually outside this PR's diff. When it is
                  // in the diff we can scroll to the exact line locally;
                  // otherwise the only place that line exists is the blob on
                  // GitHub. Either way the click lands on the right line — it
                  // never dumps the user on a tab with nothing highlighted.
                  const inDiff = changedPaths.has(c.file);
                  const blobHref =
                    repoFullName && headSha
                      ? githubBlobUrl(repoFullName, headSha, c.file, c.line)
                      : undefined;
                  const label = (
                    <>
                      <Icon.CornerDownRight
                        size={12}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                      <span className="min-w-0 font-mono truncate">
                        {c.file}:{c.line}
                      </span>
                    </>
                  );
                  const className =
                    "flex items-center gap-1.5 text-left w-full text-xs text-[var(--text-muted)] pl-2 leading-7 hover:text-[var(--text-primary)] bg-transparent border-none";

                  if (inDiff) {
                    return (
                      <button
                        key={`${c.file}:${c.line}`}
                        type="button"
                        title={t("openInDiff")}
                        onClick={() => onOpenFileLine(c.file, c.line)}
                        className={`${className} cursor-pointer hover:underline`}
                      >
                        {label}
                      </button>
                    );
                  }
                  // No repo/sha yet → plain text, not a dead click target.
                  if (!blobHref) {
                    return (
                      <span key={`${c.file}:${c.line}`} className={className}>
                        {label}
                      </span>
                    );
                  }
                  return (
                    <a
                      key={`${c.file}:${c.line}`}
                      href={blobHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("openOnGithub")}
                      className={`${className} cursor-pointer no-underline hover:underline`}
                    >
                      {label}
                    </a>
                  );
                })}

                {(sym.endpoints.length > 0 || sym.crons.length > 0) && (
                  <div className="flex gap-1.5 flex-wrap mt-2 pl-2">
                    {/* Theme tokens, not raw Tailwind hues: the light palette
                        turns indigo-300/amber-400 into unreadable pastel. */}
                    {sym.endpoints.map((e) => (
                      <span
                        key={e}
                        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-mono bg-[var(--accent-bg)] text-[var(--accent-text)]"
                      >
                        <Icon.Globe size={11} className="shrink-0" />
                        {e}
                      </span>
                    ))}
                    {sym.crons.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md font-mono bg-[var(--warn-bg)] text-[var(--warn)]"
                      >
                        <Icon.Clock size={11} className="shrink-0" />
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
