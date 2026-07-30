// Single source of truth for email permission checks on the client.
//
// This MUST mirror the server's checkPermission middleware exactly:
//   managers and superadmins bypass all checks; everyone else needs the
//   explicit permission flag.
//
// Keeping the two in sync matters because any divergence produces a control
// that renders but whose request comes back 403 — a dead button.
export const hasEmailPermission = (user, key) =>
    ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.[key] === true;

export default hasEmailPermission;
