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

                  <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="dashboard" element={<Navigate to="/" replace />} />
                    <Route path="leads" element={<Leads />} />
                    <Route path="email" element={<EmailManagement />} />
                    <Route path="whatsapp" element={<WhatsAppManagement />} />
                    <Route path="team" element={<Team />} />
                  </Route>
                </Route>
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
