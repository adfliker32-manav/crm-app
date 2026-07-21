import api from '../services/api';

// Feature display metadata (name, tagline, benefits, planHint…) comes from the
// backend registry via GET /api/features. It's static per deploy, so we fetch it
// once and cache it module-wide — the UpgradeWall reads from here so there are no
// hardcoded feature strings in the UI.
let cache = null;
let inflight = null;

export function loadFeatureMeta() {
    if (cache) return Promise.resolve(cache);
    if (!inflight) {
        inflight = api.get('/features')
            .then((res) => { cache = res.data.features || {}; return cache; })
            .catch(() => ({}))          // never let a metadata failure break a wall
            .finally(() => { inflight = null; });
    }
    return inflight;
}

// Monetization signal — fire-and-forget, never blocks or throws in the UI.
export function logUpgradeEvent(type, featureKey, extra = {}) {
    try {
        api.post('/features/upgrade-event', { type, featureKey, ...extra }).catch(() => {});
    } catch { /* analytics must never affect UX */ }
}
