/**
 * Post-UTME is a single-university programme.
 *
 * The Post-UTME CBT bank, importer and drill all key off `post_utme_exams.university`.
 * Earlier versions offered a free-text field and a six-university picker
 * (UNILAG / UI / UNN / OAU / ABU / LASU), which let papers be filed under
 * universities the programme does not serve. Everything now reads the value from
 * here so the three surfaces cannot drift apart again.
 *
 * This does NOT affect UTME sign-up, where a student still enters their own
 * desired university — that field is free text in `components/SignUp.tsx` and is
 * deliberately independent of this constant.
 */
export const POST_UTME_UNIVERSITY_CODE = 'UNILORIN';

export const POST_UTME_UNIVERSITY_NAME = 'University of Ilorin';

/**
 * Every spelling this programme's papers may carry.
 *
 * `post_utme_exams.university` is free text written by the admin importer, so a
 * match has to accept the name and the code in either case rather than one
 * exact string.
 */
const UNILORIN_ALIASES = new Set([
  POST_UTME_UNIVERSITY_CODE.toLowerCase(),
  POST_UTME_UNIVERSITY_NAME.toLowerCase(),
  'unilorin',
  'university of ilorin',
]);

/**
 * True when a stored `post_utme_exams.university` names this programme's
 * university.
 *
 * A paper with no university recorded is KEPT: those predate the
 * single-university rule, and hiding them would withdraw papers that currently
 * work.
 *
 * This lives here, not in the drill, because TWO surfaces have to agree on it.
 * The student drill hides a paper that fails this test, so a staff manager that
 * badges it "Live" without checking would advertise a paper no student can
 * reach. Both now read the same rule.
 */
export function isUnilorinPaper(university: unknown): boolean {
  const value = String(university ?? '').trim().toLowerCase();
  if (!value) return true;
  return UNILORIN_ALIASES.has(value);
}

