import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import DeviceListPage from "./pages/DeviceListPage";
import TransferPage from "./pages/TransferPage";
import TransferHistoryPage from "./pages/TransferHistoryPage";
import SettingsPage from "./pages/SettingsPage";

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/devices"
        element={isAuthenticated ? <DeviceListPage /> : <Navigate to="/login" />}
      />
      <Route
        path="/transfer/:deviceId"
        element={isAuthenticated ? <TransferPage /> : <Navigate to="/login" />}
      />
      <Route
        path="/history"
        element={isAuthenticated ? <TransferHistoryPage /> : <Navigate to="/login" />}
      />
      <Route
        path="/settings"
        element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" />}
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? "/devices" : "/login"} />} />
    </Routes>
  );
}

export default App;
