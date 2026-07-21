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
import FeatureGate from './components/FeatureGate';
import Layout from './layouts/Layout';
import AgencyLayout from './layouts/AgencyLayout';
import React, { Suspense, lazy } from 'react';
import GlobalLoader from './components/GlobalLoader';
import ErrorBoundary from './components/ErrorBoundary';

// Direct import for Login (critical path)
import Login from './pages/Login';
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));


// Lazy loaded pages
const AgencyDashboard = lazy(() => import('./pages/Agency/AgencyDashboard'));
const AgencyClients = lazy(() => import('./pages/Agency/AgencyClients'));
const AgencyWhiteLabel = lazy(() => import('./pages/Agency/AgencyWhiteLabel'));
const PartnerEarnings = lazy(() => import('./pages/Agency/PartnerEarnings'));


const Dashboard = lazy(() => import('./pages/Dashboard'));
const EmailManagement = lazy(() => import('./pages/EmailManagement'));
const Team = lazy(() => import('./pages/Team'));
const WhatsAppManagement = lazy(() => import('./pages/WhatsAppManagement'));
const Leads = lazy(() => import('./pages/Leads'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const Settings = lazy(() => import('./pages/Settings'));
const Reports = lazy(() => import('./pages/Reports'));
// Automations / Workflows / Sequences pages are composed inside AutomationHub,
// which is the only route entry point for the merged "Automation" module.
const AutomationHub = lazy(() => import('./pages/AutomationHub'));
const Appointments = lazy(() => import('./pages/Appointments'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const DataDeletionStatus = lazy(() => import('./pages/DataDeletionStatus'));
const NotFound = lazy(() => import('./pages/NotFound'));
const PaymentRequired = lazy(() => import('./pages/PaymentRequired'));
const Plans = lazy(() => import('./pages/Plans'));
const Billing = lazy(() => import('./pages/Billing'));
const VoiceHub = lazy(() => import('./pages/VoiceHub'));
const WorkflowBuilder = lazy(() => import('./pages/WorkflowBuilder'));

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
                        <Route path="/register" element={<Register />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />

                        <Route path="/book/:slug" element={<BookingPage />} />
                        <Route path="/terms" element={<TermsAndConditions />} />
                        <Route path="/privacy" element={<PrivacyPolicy />} />
                        <Route path="/deletion-status" element={<DataDeletionStatus />} />
                        <Route path="/payment-required" element={<PaymentRequired />} />
                        <Route path="/plans" element={<Plans />} />

                        <Route element={<ProtectedRoute />}>
                          <Route path="/super-admin" element={<SuperAdmin />} />
                          {/* Workflow Builder — fullscreen, no sidebar layout */}
                          <Route path="/workflows/:id/builder" element={<WorkflowBuilder />} />

                          {/* Agency Reseller Layout Routes */}
                          <Route path="/agency" element={<AgencyLayout />}>
                            <Route path="dashboard" element={<AgencyDashboard />} />
                            <Route path="clients" element={<AgencyClients />} />
                            <Route path="white-label" element={<AgencyWhiteLabel />} />
                            <Route path="partner-earnings" element={<PartnerEarnings />} />
                          </Route>


                          {/* Dashboard Layout Routes */}
                          <Route element={<Layout />}>
                            <Route path="/dashboard" element={<Dashboard />} />

                            {/* Module routes are wrapped in <FeatureGate>: a plan that
                                doesn't include the module still routes here, but renders the
                                UpgradeWall instead of the feature (soft paywall). Dashboard &
                                Billing are always accessible. */}
                            <Route path="/leads" element={<FeatureGate feature="leads" featureLabel="Leads"><Leads /></FeatureGate>} />
                            <Route path="/email" element={<FeatureGate feature="email" featureLabel="Email"><EmailManagement /></FeatureGate>} />
                            <Route path="/whatsapp" element={<FeatureGate feature="whatsapp" featureLabel="WhatsApp"><WhatsAppManagement /></FeatureGate>} />
                            <Route path="/team" element={<FeatureGate feature="team" featureLabel="Team"><Team /></FeatureGate>} />
                            {/* Legacy Automation + Workflow + Sequences now live under one
                                "Automation" hub. Each path renders the hub (the URL picks the
                                default tab) so the fullscreen builder's back-nav to /workflows
                                and existing deep links keep working. */}
                            <Route path="/automations" element={<FeatureGate feature="automation" featureLabel="Automation"><AutomationHub /></FeatureGate>} />
                            <Route path="/workflows" element={<FeatureGate feature="automation" featureLabel="Automation"><AutomationHub /></FeatureGate>} />
                            <Route path="/sequences" element={<FeatureGate feature="automation" featureLabel="Automation"><AutomationHub /></FeatureGate>} />
                            <Route path="/appointments" element={<FeatureGate feature="appointments" featureLabel="Appointments"><Appointments /></FeatureGate>} />
                            {/* Settings is NOT gated as a whole — it holds universal Profile /
                                password. Paid sub-tabs (Meta Sync, API Access) are gated inside
                                the page individually; the rest stay reachable on every plan. */}
                            <Route path="/settings" element={<Settings />} />
                            <Route path="/reports" element={<FeatureGate feature="reports" featureLabel="Analytics"><Reports /></FeatureGate>} />
                            <Route path="/billing" element={<Billing />} />
                            <Route path="/voice-hub" element={<FeatureGate feature="voice" featureLabel="AI Voice"><VoiceHub /></FeatureGate>} />
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
