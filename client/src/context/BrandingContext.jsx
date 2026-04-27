/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const BrandingContext = createContext({
    brandName: 'Adfliker',
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    logoUrl: ''
});

// eslint-disable-next-line react-refresh/only-export-components
export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider = ({ children }) => {
    const { user } = useAuth();
    const [branding, setBranding] = useState({
        brandName: 'Adfliker',
        primaryColor: '#6366f1',
        secondaryColor: '#8b5cf6',
        logoUrl: '',
        faviconUrl: ''
    });

    useEffect(() => {
        const loadBranding = async () => {
            // Only sub-clients (managers/agents) need dynamic branding
            // If no agencyId, use platform defaults
            const agencyId = user?.agencyId;
            if (!agencyId) return;

            try {
                const res = await api.get(`/agency/branding/${agencyId}`);
                if (res.data) {
                    const b = res.data;
                    setBranding(b);

                    // --- Inject CSS variables into :root ---
                    const root = document.documentElement;
                    if (b.primaryColor) root.style.setProperty('--color-primary', b.primaryColor);
                    if (b.secondaryColor) root.style.setProperty('--color-secondary', b.secondaryColor);

                    // Apply brand name as page title
                    if (b.brandName) document.title = b.brandName + ' CRM';

                    // Swap favicon if provided
                    if (b.faviconUrl) {
                        const favicon = document.querySelector("link[rel~='icon']");
                        if (favicon) favicon.href = b.faviconUrl;
                    }
                }
            } catch (e) {
                // Silent fail — use platform defaults
            }
        };

        loadBranding();
    }, [user]);

    return (
        <BrandingContext.Provider value={branding}>
            {children}
        </BrandingContext.Provider>
    );
};
