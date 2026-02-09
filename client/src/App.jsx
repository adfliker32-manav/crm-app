import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { PromptProvider } from './context/PromptContext';
import NotificationContainer from './components/NotificationContainer';
import ConfirmDialog from './components/ConfirmDialog';
import PromptDialog from './components/PromptDialog';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './layouts/Layout';
import Dashboard from './pages/Dashboard';
import EmailManagement from './pages/EmailManagement';
import Team from './pages/Team';
import WhatsAppManagement from './pages/WhatsAppManagement';
import Leads from './pages/Leads';
import Login from './pages/Login';
import Register from './pages/Register';
import SuperAdmin from './pages/SuperAdmin';
import Settings from './pages/Settings';
import Reports from './pages/Reports';

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <ConfirmProvider>
          <PromptProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />

                <Route element={<ProtectedRoute />}>
                  <Route path="/super-admin" element={<SuperAdmin />} />

                  {/* Dashboard Layout Routes */}
                  <Route element={<Layout />}>
                    <Route path="/dashboard" element={<Dashboard />} />

                    {/* Preserve other routes as siblings if you want them accessible strictly under layout, 
                        BUT originally they were at root. Since Layout uses <Outlet>, nesting them under a 
                        pathless layout route keeps their paths but wraps them. 
                        However, we want to start organizing better. 
                        If we keeping old paths:
                    */}
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/email" element={<EmailManagement />} />
                    <Route path="/whatsapp" element={<WhatsAppManagement />} />
                    <Route path="/team" element={<Team />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/reports" element={<Reports />} />
                  </Route>
                </Route>

                {/* Default root redirects to login for now (no Landing Page) */}
                <Route path="/" element={<Navigate to="/login" replace />} />
              </Routes>
              <NotificationContainer />
              <ConfirmDialog />
              <PromptDialog />
            </BrowserRouter>
          </PromptProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
