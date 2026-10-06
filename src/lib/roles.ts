/**
 * Who counts as an administrator.
 *
 * The platform has stored this as three different strings over its life —
 * 'Admin' (the seed and the provisioning Edge Function), 'admin' and
 * 'Super Admin' — and the backend accepts all three. The maintenance gate was
 * the one place that compared against the literal 'Admin', so an account stored
 * as 'Super Admin' could still sign in, was still allowed to write the setting,
 * and yet was shown the maintenance screen — i.e. locked out of the one surface
 * that switches maintenance back off.
 *
 * This mirrors `isAdminRole` in server.ts exactly: trim, lower-case, then
 * membership of the same two values. The two are deliberately the same test
 * written twice rather than one shared import, because the frontend and the
 * server are separate bundles and no module can live in both. If they ever
 * disagree the failure mode is an administrator lockout, so any change to one
 * must be made to the other.
 *
 * The role is only ever READ here. It is never normalised, rewritten or sent
 * back to the database, so an account stored as 'Super Admin' keeps storing
 * 'Super Admin'.
 */
const ADMIN_ROLES = ['admin', 'super admin'];

export function isAdminRole(role: unknown): boolean {
  return typeof role === 'string' && ADMIN_ROLES.includes(role.trim().toLowerCase());
}
