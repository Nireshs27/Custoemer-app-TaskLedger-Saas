import { useRef, useCallback } from 'react';

/**
 * Hook to prevent double-triggering of file dialogs.
 * Useful when multiple nested elements (like a button inside a dropzone) 
 * both try to trigger the file input.
 */
export function useSingleFileDialogTrigger() {
  const isOpeningRef = useRef(false);

  const trigger = useCallback((inputRef: React.RefObject<HTMLInputElement>) => {
    if (isOpeningRef.current) {
      return;
    }
    
    if (!inputRef.current) {
      console.warn("useSingleFileDialogTrigger: inputRef is null");
      return;
    }

    isOpeningRef.current = true;
    inputRef.current.click();
    
    // Reset after a short delay to allow legitimate subsequent clicks
    // but block immediate duplicates from bubbling or rapid clicks.
    // 150ms is enough to cover bubbling and most accidental double-clicks.
    setTimeout(() => {
      isOpeningRef.current = false;
    }, 150);
  }, []);

  return trigger;
}
