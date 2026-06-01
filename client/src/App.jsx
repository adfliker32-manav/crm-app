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
import ErrorBoundary from './components/ErrorBoundary';

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
const Sequences = lazy(() => import('./pages/Sequences'));
const Appointments = lazy(() => import('./pages/Appointments'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const DataDeletionStatus = lazy(() => import('./pages/DataDeletionStatus'));
const NotFound = lazy(() => import('./pages/NotFound'));
const PaymentRequired = lazy(() => import('./pages/PaymentRequired'));
const Plans = lazy(() => import('./pages/Plans'));
const Billing = lazy(() => import('./pages/Billing'));

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
                <ErrorBoundary>
                <Suspense fallback={<GlobalLoader />}>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/book/:slug" element={<BookingPage />} />
                    <Route path="/terms" element={<TermsAndConditions />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/deletion-status" element={<DataDeletionStatus />} />
                    <Route path="/payment-required" element={<PaymentRequired />} />
                    <Route path="/plans" element={<Plans />} />

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
                        <Route path="/sequences" element={<Sequences />} />
                        <Route path="/appointments" element={<Appointments />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/billing" element={<Billing />} />
                      </Route>
                    </Route>

                    {/* Default root redirects to login for now (no Landing Page) */}
                    <Route path="/" element={<Navigate to="/login" replace />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
                <NotificationContainer />

                <ConfirmDialog />
                <PromptDialog />
                </ErrorBoundary>
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
