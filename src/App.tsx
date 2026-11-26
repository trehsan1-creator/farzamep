import { useState } from 'react';
import { AuthProvider, getRoleLabel, useAuth } from './contexts/AuthContext';
import { FiscalYearProvider } from './contexts/FiscalYearContext';
import { LayoutShell } from './components/LayoutShell';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { VoucherWorkbenchView } from './components/VoucherWorkbenchView';
import { ExcelImporterView } from './components/ExcelImporterView';
import { AgentQueueView } from './components/AgentQueueView';
import { YearEndClosingView } from './components/YearEndClosingView';
import { StatementsAndMcpView } from './components/StatementsAndMcpView';
import { MasterDataView } from './components/MasterDataView';
import { AgentManagementCenter } from './components/AgentManagementCenter';
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

function AuthenticatedWorkspace({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [activeView, setActiveView] = useState<ActiveViewId>('dashboard');

  return (
    <LayoutShell activeView={activeView} onSelectView={setActiveView} onSignOut={onSignOut}>
      {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
      {activeView === 'vouchers' && <VoucherWorkbenchView />}
      {activeView === 'excel_import' && <ExcelImporterView />}
      {activeView === 'agent_queue' && <AgentQueueView />}
      {activeView === 'year_end' && <YearEndClosingView onNavigate={setActiveView} />}
      {activeView === 'statements' && <StatementsAndMcpView />}
      {activeView === 'master_data' && <MasterDataView />}
      {activeView === 'agent_center' && <AgentManagementCenter />}
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

