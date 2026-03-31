import { GoogleOAuthProvider } from '@react-oauth/google';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { NotificationProvider } from './context/NotificationContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { PromptProvider } from './context/PromptContext';
import NotificationContainer from './components/NotificationContainer';
import ConfirmDialog from './components/ConfirmDialog';
import PromptDialog from './components/PromptDialog';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './layouts/Layout';
import AgencyLayout from './layouts/AgencyLayout';
import React, { Suspense, lazy } from 'react';
import GlobalLoader from './components/GlobalLoader';

// Direct import for Login (critical path)
import Login from './pages/Login';

// Lazy loaded pages
const AgencyDashboard = lazy(() => import('./pages/Agency/AgencyDashboard'));
const AgencyClients = lazy(() => import('./pages/Agency/AgencyClients'));
const AgencyWhiteLabel = lazy(() => import('./pages/Agency/AgencyWhiteLabel'));

const Dashboard = lazy(() => import('./pages/Dashboard'));
const EmailManagement = lazy(() => import('./pages/EmailManagement'));
const Team = lazy(() => import('./pages/Team'));
const WhatsAppManagement = lazy(() => import('./pages/WhatsAppManagement'));
const Leads = lazy(() => import('./pages/Leads'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));
const Automations = lazy(() => import('./pages/Automations'));

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <BrandingProvider>
        <NotificationProvider>
          <ConfirmProvider>
            <PromptProvider>
              <BrowserRouter>
                <Suspense fallback={<GlobalLoader />}>
                  <Routes>
                    <Route path="/login" element={<Login />} />

                    <Route element={<ProtectedRoute />}>
                      <Route path="/super-admin" element={<SuperAdmin />} />

                      {/* Agency Reseller Layout Routes */}
                      <Route path="/agency" element={<AgencyLayout />}>
                        <Route path="dashboard" element={<AgencyDashboard />} />
                        <Route path="clients" element={<AgencyClients />} />
                        <Route path="white-label" element={<AgencyWhiteLabel />} />
                      </Route>

                      {/* Dashboard Layout Routes */}
                      <Route element={<Layout />}>
                        <Route path="/dashboard" element={<Dashboard />} />

                        <Route path="/leads" element={<Leads />} />
                        <Route path="/email" element={<EmailManagement />} />
                        <Route path="/whatsapp" element={<WhatsAppManagement />} />
                        <Route path="/team" element={<Team />} />
                        <Route path="/automations" element={<Automations />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/reports" element={<Reports />} />
                      </Route>
                    </Route>

                    {/* Default root redirects to login for now (no Landing Page) */}
                    <Route path="/" element={<Navigate to="/login" replace />} />
                  </Routes>
                </Suspense>
                <NotificationContainer />

                <ConfirmDialog />
                <PromptDialog />
              </BrowserRouter>
            </PromptProvider>
          </ConfirmProvider>
        </NotificationProvider>
        </BrandingProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
