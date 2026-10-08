/**
 * Which route each programme's CBT and learning surfaces live on.
 *
 * WHY THIS MODULE EXISTS
 *
 * The mapping used to be copied inline into every component that needed it —
 * `Sidebar.tsx` and `QuickActions.tsx` each had their own identical chain — while
 * three other places (the analytics empty state, the profile activity list and
 * the dashboard activity feed) simply hardcoded `'utme'` and sent every student
 * to the UTME centre regardless of what they had enrolled for. An Undergraduate
 * pressing "Take a CBT" therefore landed in the UTME CBT centre.
 *
 * One mapping, one place to change it.
 *
 * WHY POST-UTME RESOLVES TO `'utme'`
 *
 * `UTMECBTPage` is not only the UTME centre: it branches on the profile and
 * renders `PostUtmeDrillPage` for a Post-UTME candidate (see its own portal
 * check). So `'utme'` IS the Post-UTME CBT route; there is no separate one. The
 * two programmes are rendered from the same entry point and the profile decides
 * which they see — which is exactly why the route does not need to differ.
 *
 * THE DEFAULT
 *
 * `normalisePortal` falls back to `'Undergraduate'` when `profiles.portal` is
 * absent, matching the convention already used by the Sidebar and Quick Actions
 * (`profile?.portal || 'Undergraduate'`). Note that this is only about where a
 * button SENDS a student. It is deliberately NOT the pattern to follow for
 * statistics: a stat must never branch on the portal string, because a wrong
 * guess there silently returns an empty table. Navigation can be corrected by
 * the user in one click; a dashboard reading zero has no such escape.
 */

export type StudentPortal = 'Undergraduate' | 'UTME' | 'Post-UTME';

interface PortalTarget {
  /** Route for the CBT centre this programme sits. */
  cbtRoute: string;
  /** What that CBT is called, for button labels. */
  cbtLabel: string;
  /** Route for this programme's Course → Topic → Lesson library. */
  learningRoute: string;
}

const TARGETS: Record<StudentPortal, PortalTarget> = {
  Undergraduate: {
    cbtRoute: 'cbt',
    cbtLabel: 'Undergraduate CBT',
    learningRoute: 'academic-materials',
  },
  UTME: {
    cbtRoute: 'utme',
    cbtLabel: 'UTME CBT',
    learningRoute: 'academic-materials',
  },
  'Post-UTME': {
    // Same route as UTME by design — see the note above.
    cbtRoute: 'utme',
    cbtLabel: 'Post-UTME CBT',
    learningRoute: 'post-utme-learning',
  },
};

/**
 * Coerce a stored portal value to one of the three programmes.
 *
 * Matching is case- and punctuation-insensitive so that `'Post-UTME'`,
 * `'Post UTME'` and `'post-utme'` all land on the same entry — the column is
 * free text and has been written in more than one spelling. Anything
 * unrecognised falls back to Undergraduate.
 *
 * `'postutme'` is tested first because it contains `'utme'`; checking UTME first
 * would swallow every Post-UTME student.
 */
export function normalisePortal(portal?: string | null): StudentPortal {
  const key = String(portal ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (key === 'postutme') return 'Post-UTME';
  if (key === 'utme') return 'UTME';
  return 'Undergraduate';
}

/** The route of the CBT centre this student should be sent to. */
export function cbtRouteForPortal(portal?: string | null): string {
  return TARGETS[normalisePortal(portal)].cbtRoute;
}

/** The display name of that CBT centre, e.g. "Undergraduate CBT". */
export function cbtLabelForPortal(portal?: string | null): string {
  return TARGETS[normalisePortal(portal)].cbtLabel;
}

/**
 * The route of this student's learning library. Post-UTME has its own page;
 * Undergraduate uses the academic materials library.
 */
export function learningRouteForPortal(portal?: string | null): string {
  return TARGETS[normalisePortal(portal)].learningRoute;
}
