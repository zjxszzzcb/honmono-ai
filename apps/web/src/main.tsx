import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./auth";
import { Landing } from "./pages/Landing";
import { Login, Register } from "./pages/Login";
import { Activate } from "./pages/Activate";
import { Dashboard } from "./pages/Dashboard";
import { Configure } from "./pages/Configure";
import { TestPlayground } from "./pages/TestPlayground";
import { ApiKeys } from "./pages/ApiKeys";
import { Handoffs } from "./pages/Handoffs";
import { AdminLogin } from "./pages/admin/AdminLogin";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminOverview } from "./pages/admin/Overview";
import { AdminUsers } from "./pages/admin/Users";
import { AdminUserDetail } from "./pages/admin/Users";
import { AdminServices } from "./pages/admin/Services";
import { AdminInvites } from "./pages/admin/Invites";
import { AdminLlm } from "./pages/admin/Llm";
import { AdminAuditLogs, AdminSettings } from "./pages/admin/Settings";

function RequireMerchant({ children }: { children: React.ReactNode }) {
  const { merchant, loading } = useAuth();
  if (loading) return <div className="p-10 text-slate-500">加载中…</div>;
  if (!merchant) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();
  if (loading) return <div className="p-10 text-slate-500">加载中…</div>;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/activate" element={<RequireMerchant><Activate /></RequireMerchant>} />
          <Route path="/dashboard" element={<RequireMerchant><Dashboard /></RequireMerchant>} />
          <Route path="/services/:id/configure" element={<RequireMerchant><Configure /></RequireMerchant>} />
          <Route path="/services/:id/test" element={<RequireMerchant><TestPlayground /></RequireMerchant>} />
          <Route path="/services/:id/keys" element={<RequireMerchant><ApiKeys /></RequireMerchant>} />
          <Route path="/services/:id/handoffs" element={<RequireMerchant><Handoffs /></RequireMerchant>} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="services" element={<AdminServices />} />
            <Route path="invites" element={<AdminInvites />} />
            <Route path="llm" element={<AdminLlm />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="audit-logs" element={<AdminAuditLogs />} />
          </Route>
          <Route path="*" element={<div className="p-10">页面不存在</div>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
