// Frontend entitlement check — the single helper the whole app uses to decide
// whether a plan unlocks a module/feature. Mirrors the server resolution
// delivered in `user.entitlements` (see authController.buildLoginUserResponse).
//
// Model: locked ONLY when explicitly disabled. A missing/true value = allowed.
// This keeps trial + not-yet-refreshed sessions fully unlocked and matches the
// opt-out semantics of the feature registry. Locked features are never hidden —
// callers show them and gate access with <FeatureGate> / <UpgradeWall>.
export const hasEntitlement = (user, key) => {
    if (!user) return false;
    // SuperAdmin / agency operate above tenant plans (no WorkspaceSettings doc).
    if (user.role === 'superadmin' || user.role === 'agency') return true;
    return user.entitlements?.[key] !== false;
};
