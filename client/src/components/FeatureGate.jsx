import React from 'react';
import { useAuth } from '../context/AuthContext';
import { hasEntitlement } from '../utils/entitlements';
import UpgradeWall from './UpgradeWall';

// Renders `children` when the plan unlocks `feature`; otherwise renders the
// (registry-driven) UpgradeWall. Use it to wrap a whole module route or an
// individual sub-feature panel — `feature` is a registry node key (e.g.
// 'whatsapp', 'whatsapp.chatbot.ai', 'reports.advanced').
const FeatureGate = ({ feature, featureLabel, destination, source = 'route', children }) => {
    const { user } = useAuth();
    if (hasEntitlement(user, feature)) return children;
    return <UpgradeWall feature={feature} featureLabel={featureLabel} destination={destination} source={source} />;
};

export default FeatureGate;
