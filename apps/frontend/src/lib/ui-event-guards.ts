/**
 * UI Event Guards - Prevents entity menu/modal interactions from triggering parent card clicks
 */

/**
 * Check if an event originated from entity menu or modal interactions
 */
export function isFromEntityMenuInteraction(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  // Check if click came from kebab menu trigger, content, or any modal
  return !!(
    target.closest('[data-entity-menu-trigger="true"]') ||
    target.closest('[data-entity-menu-content="true"]') ||
    target.closest('[data-entity-modal="attachments"]') ||
    target.closest('[data-entity-modal="overview"]')
  );
}

/**
 * Guard card click handler - blocks if event came from menu/modal
 * Returns true if event was blocked
 */
export function guardCardClick(e: React.MouseEvent | React.PointerEvent): boolean {
  if (isFromEntityMenuInteraction(e.target)) {
    // We only need to stop propagation and return true to prevent the card's own onClick.
    // Calling preventDefault() on a click event that bubbles from a file input
    // prevents the OS file picker from opening.
    e.stopPropagation();
    return true;
  }
  return false;
}
