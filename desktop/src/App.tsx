import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import AppLayout from "./components/AppLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import DeviceListPage from "./pages/DeviceListPage";
import TransferPage from "./pages/TransferPage";
import TransferHistoryPage from "./pages/TransferHistoryPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";

import { MobileLoginPage } from "./pages/mobile/MobileLoginPage";
import { MobileRegisterPage } from "./pages/mobile/MobileRegisterPage";
import { MobileMainPage } from "./pages/mobile/MobileMainPage";
import { MobileTransferPage } from "./pages/mobile/MobileTransferPage";
import { MobilePairingPage } from "./pages/mobile/MobilePairingPage";

function useIsMobile() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return isMobile;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function MobileLoginWrapper() {
  const navigate = useNavigate();
  return <MobileLoginPage onNavigate={(page) => {
    if (page === 'register') navigate('/register');
    else if (page === 'forgot') navigate('/forgot-password');
    else if (page === 'main') navigate('/devices');
  }} />;
}

function MobileRegisterWrapper() {
  const navigate = useNavigate();
  return <MobileRegisterPage onNavigate={(page) => {
    if (page === 'login') navigate('/login');
    else if (page === 'main') navigate('/devices');
  }} />;
}

function App() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Routes>
        <Route path="/login" element={<MobileLoginWrapper />} />
        <Route path="/register" element={<MobileRegisterWrapper />} />
        <Route path="/transfer/:deviceId" element={<RequireAuth><MobileTransferPage /></RequireAuth>} />
        <Route path="/pair" element={<RequireAuth><MobilePairingPage /></RequireAuth>} />
        <Route path="/devices" element={<RequireAuth><MobileMainPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/devices" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/devices" element={<DeviceListPage />} />
        <Route path="/transfer/:deviceId" element={<TransferPage />} />
        <Route path="/history" element={<TransferHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/devices" replace />} />
    </Routes>
  );
}

export default App;