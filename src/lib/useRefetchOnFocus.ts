import { useEffect, useRef } from 'react';

/**
 * Re-run a fetch when the tab is focused or becomes visible again.
 *
 * WHY THIS EXISTS
 *
 * Navigating between the dashboard, a CBT and the analytics page already
 * refetches, because each view is rendered conditionally in `App.tsx` — leaving
 * one unmounts it, and coming back mounts a fresh instance that queries again.
 * What that does not cover is the tab staying open: a student finishes a CBT,
 * switches to another tab or window and comes back, and the page they left is
 * still mounted showing the figures it fetched before the attempt was recorded.
 *
 * A CBT result is written by the server on submit, so nothing in the client can
 * be notified of it. Re-reading when the page is looked at again is the one
 * signal available, and it costs nothing while the tab is in the background.
 *
 * The callback is held in a ref so the listeners are attached once rather than
 * being torn down and re-added on every render — callers pass an inline arrow
 * function, and depending on its identity would re-subscribe constantly.
 */
export function useRefetchOnFocus(refetch: () => void): void {
  const latest = useRef(refetch);
  latest.current = refetch;

  useEffect(() => {
    const run = () => latest.current();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };

    // `focus` covers returning from another window; `visibilitychange` covers
    // returning to a backgrounded tab, which does not always fire focus.
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
