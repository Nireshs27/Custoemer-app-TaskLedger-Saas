import { differenceInMilliseconds, isAfter, isSameDay } from "date-fns";

export interface OccurrenceWithDate {
  id: string;
  calculatedTaskDateUtc: string;
  occurrenceIndex: number;
}

export interface NearestOccurrenceResult {
  id: string;
  index: number;
  occurrenceNumber: number;
}

/**
 * Find the occurrence nearest to a target date
 * Uses absolute time distance on the occurrence's task date
 * Tie-breaker: prefer future (>= target) if equal distance
 * 
 * @param occurrences - Array of occurrences (can be sorted or unsorted)
 * @param targetDate - The date to find nearest occurrence to
 * @returns Object with {id, index, occurrenceNumber} or null if no occurrences
 */
export function findNearestOccurrence(
  occurrences: OccurrenceWithDate[],
  targetDate: Date
): NearestOccurrenceResult | null {
  if (!occurrences || occurrences.length === 0) {
    return null;
  }

  if (!targetDate || Number.isNaN(targetDate.getTime())) {
    return null;
  }

  let nearestIndex = 0;
  let minDistance = Number.MAX_SAFE_INTEGER;
  let nearestIsFuture = false;

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    if (!occ?.calculatedTaskDateUtc) continue;

    const occDate = new Date(occ.calculatedTaskDateUtc);
    if (Number.isNaN(occDate.getTime())) continue;

    // Check if same day (exact match)
    if (isSameDay(occDate, targetDate)) {
      return {
        id: occ.id,
        index: i,
        occurrenceNumber: occ.occurrenceIndex + 1,
      };
    }

    const distance = Math.abs(differenceInMilliseconds(occDate, targetDate));
    const isFuture = isAfter(occDate, targetDate);

    // Update if:
    // 1. Distance is strictly smaller, OR
    // 2. Distance is equal AND this is future while previous wasn't (tie-breaker)
    if (
      distance < minDistance ||
      (distance === minDistance && isFuture && !nearestIsFuture)
    ) {
      minDistance = distance;
      nearestIndex = i;
      nearestIsFuture = isFuture;
    }
  }

  const nearest = occurrences[nearestIndex];
  return {
    id: nearest.id,
    index: nearestIndex,
    occurrenceNumber: nearest.occurrenceIndex + 1,
  };
}

/**
 * Scroll an element into view smoothly and center it
 * Waits for DOM to be ready using requestAnimationFrame
 */
export function scrollToOccurrence(
  scrollContainer: HTMLElement | null,
  occurrenceId: string,
  onComplete?: () => void
): () => void {
  if (!scrollContainer || !occurrenceId) {
    return () => {};
  }

  let rafId: number | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  const performScroll = () => {
    const selector = `[data-occurrence-id="${occurrenceId}"]`;
    const element = scrollContainer.querySelector(selector) as HTMLElement | null;

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
      onComplete?.();
    }
  };

  // Wait for DOM paint, then perform scroll
  rafId = requestAnimationFrame(() => {
    timeoutId = setTimeout(performScroll, 50);
  });

  // Cleanup function
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timeoutId !== null) clearTimeout(timeoutId);
  };
}

/**
 * Scroll to an occurrence within a container using container-relative math (NO scrollIntoView).
 * Retries with requestAnimationFrame until the element exists or max tries reached.
 * This is more stable for pagination because it scrolls only the specified container.
 * 
 * @param scrollContainer - The scrollable container element
 * @param occurrenceId - The occurrence ID to scroll to
 * @param opts - Options for alignment, behavior, and retry limit
 * @returns Promise<boolean> - true if scroll succeeded, false if element not found
 */
export function scrollToOccurrenceWithinContainer(
  scrollContainer: HTMLElement | null,
  occurrenceId: string,
  opts?: { align?: "center" | "start"; behavior?: ScrollBehavior; maxTries?: number }
): Promise<boolean> {
  if (!scrollContainer || !occurrenceId) return Promise.resolve(false);

  const align = opts?.align ?? "center";
  const behavior = opts?.behavior ?? "auto";
  const maxTries = opts?.maxTries ?? 12;
  let tries = 0;

  return new Promise((resolve) => {
    const attempt = () => {
      tries += 1;
      const selector = `[data-occurrence-id="${occurrenceId}"]`;
      const el = scrollContainer.querySelector(selector) as HTMLElement | null;

      if (!el) {
        if (tries >= maxTries) return resolve(false);
        return requestAnimationFrame(attempt);
      }

      // Container-relative offset
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const delta = elTop - containerTop;
      let nextTop = scrollContainer.scrollTop + delta;

      if (align === "center") {
        nextTop =
          nextTop -
          scrollContainer.clientHeight / 2 +
          el.clientHeight / 2;
      }

      // Clamp
      nextTop = Math.max(0, Math.min(nextTop, scrollContainer.scrollHeight - scrollContainer.clientHeight));

      scrollContainer.scrollTo({ top: nextTop, behavior });
      resolve(true);
    };

    requestAnimationFrame(attempt);
  });
}

