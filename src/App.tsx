import { lazy, Suspense, useState } from 'react';
import { AuthProvider, getRoleLabel, useAuth } from './contexts/AuthContext';
import { FiscalYearProvider } from './contexts/FiscalYearContext';
import { LayoutShell } from './components/LayoutShell';
import { LoginView } from './components/LoginView';
const DashboardView = lazy(() => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })));
const VoucherWorkbenchView = lazy(() => import('./components/VoucherWorkbenchView').then((m) => ({ default: m.VoucherWorkbenchView })));
const ExcelImporterView = lazy(() => import('./components/ExcelImporterView').then((m) => ({ default: m.ExcelImporterView })));
const AgentQueueView = lazy(() => import('./components/AgentQueueView').then((m) => ({ default: m.AgentQueueView })));
const YearEndClosingView = lazy(() => import('./components/YearEndClosingView').then((m) => ({ default: m.YearEndClosingView })));
const StatementsAndMcpView = lazy(() => import('./components/StatementsAndMcpView').then((m) => ({ default: m.StatementsAndMcpView })));
const MasterDataView = lazy(() => import('./components/MasterDataView').then((m) => ({ default: m.MasterDataView })));
const AgentManagementCenter = lazy(() => import('./components/AgentManagementCenter').then((m) => ({ default: m.AgentManagementCenter })));
import { getSupabaseCredentials } from './lib/supabase';
import type { ActiveViewId } from './types/erp';

function LoadingScreen() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#071522] text-[#F8FAFC] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-[#FF7A00]" />
        <p className="text-sm text-[#CBD5E1]">در حال بررسی نشست امن شما...</p>
      </div>
    </main>
  );
}

function ViewLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-[#CBD5E1]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#FF7A00]" />
        <span>در حال بارگذاری بخش...</span>
      </div>
    </div>
  );
}

function AuthenticatedWorkspace({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [activeView, setActiveView] = useState<ActiveViewId>('dashboard');

  return (
    <LayoutShell activeView={activeView} onSelectView={setActiveView} onSignOut={onSignOut}>
      <Suspense fallback={<ViewLoading />}>
        {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
        {activeView === 'vouchers' && <VoucherWorkbenchView />}
        {activeView === 'excel_import' && <ExcelImporterView />}
        {activeView === 'agent_queue' && <AgentQueueView />}
        {activeView === 'year_end' && <YearEndClosingView onNavigate={setActiveView} />}
        {activeView === 'statements' && <StatementsAndMcpView />}
        {activeView === 'master_data' && <MasterDataView />}
        {activeView === 'agent_center' && <AgentManagementCenter />}
      </Suspense>
    </LayoutShell>
  );
}

function AppRouter() {
  const auth = useAuth();
  const configured = getSupabaseCredentials().source !== 'unconfigured';

  if (auth.status === 'loading') return <LoadingScreen />;

  if (auth.status === 'configuration_error' || !configured) {
    return (
      <LoginView
        configured={false}
        onSubmit={auth.signIn}
        onBootstrap={auth.bootstrapAdmin}
      />
    );
  }

  if (auth.status !== 'authenticated' || !auth.profile) {
    return (
      <LoginView
        configured
        onSubmit={auth.signIn}
        onBootstrap={auth.bootstrapAdmin}
      />
    );
  }

  return (
    <FiscalYearProvider userRole={getRoleLabel(auth.profile.role)}>
      <AuthenticatedWorkspace onSignOut={auth.signOut} />
    </FiscalYearProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

