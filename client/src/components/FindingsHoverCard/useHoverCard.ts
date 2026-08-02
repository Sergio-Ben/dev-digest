"use client";

import React from "react";
import { CARD_GAP, CARD_MAX_HEIGHT, CARD_WIDTH, CLOSE_DELAY_MS, VIEWPORT_MARGIN } from "./constants";

export type CardPos = { left: number; top?: number; bottom?: number };

/** Anchor the card under the trigger, flipping above when the trigger sits low
 *  in the viewport, and clamp it inside the horizontal edges. */
export function cardPosition(r: DOMRect): CardPos {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(r.left, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN),
  );
  const roomBelow = window.innerHeight - r.bottom;
  return roomBelow < CARD_MAX_HEIGHT + CARD_GAP && r.top > roomBelow
    ? { left, bottom: window.innerHeight - r.top + CARD_GAP }
    : { left, top: r.bottom + CARD_GAP };
}

/**
 * Hover state + viewport positioning for a portalled hover card.
 *
 * The card must be portalled to <body>: both the PR-table card and the timeline
 * rows clip their children (`overflow: hidden` for rounded corners), so an
 * in-flow popover gets cut at the row boundary. `pos` is null while closed, so
 * callers render nothing until the first hover.
 */
export function useHoverCard<T extends HTMLElement = HTMLDivElement>() {
  const anchorRef = React.useRef<T | null>(null);
  const [pos, setPos] = React.useState<CardPos | null>(null);

  const reposition = React.useCallback(() => {
    const el = anchorRef.current;
    if (el) setPos(cardPosition(el.getBoundingClientRect()));
  }, []);

  // Hover intent: the card sits CARD_GAP px away, so closing straight away on
  // mouseleave would shut it while the pointer crosses the gap — you could
  // never reach the card to scroll it.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const open = React.useCallback(() => {
    cancelClose();
    reposition();
  }, [reposition]);
  const close = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPos(null), CLOSE_DELAY_MS);
  }, []);
  React.useEffect(() => cancelClose, []);

  // A `fixed` card doesn't follow the page — re-anchor it while it's open.
  React.useEffect(() => {
    if (pos == null) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [pos, reposition]);

  /** Spread on BOTH the trigger and the card so moving between them keeps it open. */
  const hoverProps = { onMouseEnter: open, onMouseLeave: close };
  return { anchorRef, pos, open, close, hoverProps };
}
