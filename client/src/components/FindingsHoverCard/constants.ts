/** Hover-card geometry. Keep in sync with `styles.ts` `card` (width/maxHeight)
 *  — the flip-above decision is computed from these numbers. */
export const CARD_WIDTH = 460;
export const CARD_MAX_HEIGHT = 420;
/** Gap between the trigger and the card, in px. */
export const CARD_GAP = 8;
/** Minimum distance the card keeps from the viewport edges, in px. */
export const VIEWPORT_MARGIN = 12;
/** Grace period before closing, so the pointer can cross the gap to the card. */
export const CLOSE_DELAY_MS = 140;
