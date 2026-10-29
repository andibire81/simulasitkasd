/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LandingPage } from './components/LandingPage';
import { AuthPortalMode, AuthView } from './components/AuthView';
import { StudentDashboard } from './components/StudentDashboard';
import { CbtExamRunner } from './components/CbtExamRunner';
import { AdminDashboard } from './components/AdminDashboard';
import { AttemptRecord, ExamRecord } from './types/cbt';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'Terjadi kesalahan tidak terduga pada aplikasi.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        readable = `Kesalahan akses database (${parsed.operationType || 'operasi'} pada ${
          parsed.path || 'koleksi'
        }): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: readable };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught Application Error:', error, info);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold">Gangguan Sistem Terdeteksi</h1>
            </div>
            <p className="text-sm text-slate-700 break-words">{this.state.message}</p>
            <p className="text-xs text-slate-500">
              Jawaban ujian Anda yang terakhir tetap tersimpan secara aman. Muat ulang halaman untuk melanjutkan.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4" />
                Muat Ulang Aplikasi
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getInitialPortalModeFromUrl(): AuthPortalMode | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const daftar = (params.get('daftar') || params.get('register') || '').toLowerCase();
    if (daftar === 'admin' || daftar === 'sekolah' || daftar === 'guru') {
      return 'admin_register';
    }
    const portal = (params.get('portal') || '').toLowerCase();
    if (portal === 'admin') return 'admin';
    if (portal === 'siswa') return 'student';
  } catch {
    // ignore URL parse error
  }
  return null;
}

const AppRouter: React.FC = () => {
  const {
    firebaseUser,
    studentSession,
    profile,
    isAdmin,
    adminOnboardingState,
    authReady,
  } = useAuth();

  const [authPortalMode, setAuthPortalMode] = useState<AuthPortalMode | null>(() =>
    getInitialPortalModeFromUrl()
  );
  const [adminViewingStudentPortal, setAdminViewingStudentPortal] = useState(false);
  const [activeSession, setActiveSession] = useState<{
    exam: ExamRecord;
    attempt: AttemptRecord;
  } | null>(null);

  const isAuthenticatedAdmin = Boolean(firebaseUser && isAdmin);
  const isAuthenticatedStudent = Boolean(studentSession && profile);
  const isSignedIn = isAuthenticatedAdmin || isAuthenticatedStudent;
  const isOnboardingTeacher = Boolean(
    firebaseUser && !isAdmin && adminOnboardingState !== 'none'
  );

  // Clean URL query param once Admin is authenticated
  useEffect(() => {
    if (isAuthenticatedAdmin && window.location.search) {
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        // ignore
      }
    }
  }, [isAuthenticatedAdmin]);

  // Reset active session on sign-out
  useEffect(() => {
    if (!isSignedIn) {
      setActiveSession(null);
      setAdminViewingStudentPortal(false);
    }
  }, [isSignedIn]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-700 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
        <p className="text-sm font-medium">Memuat sistem ujian CBT...</p>
      </div>
    );
  }

  // Signed in with Google but completing School Admin registration / checking approval
  if (isOnboardingTeacher) {
    return (
      <AuthView
        mode="admin_register"
        onSwitchMode={(m) => setAuthPortalMode(m)}
        onBackHome={() => setAuthPortalMode(null)}
      />
    );
  }

  // Not signed in -> Landing Page or Auth Portal
  if (!isSignedIn) {
    if (authPortalMode) {
      return (
        <AuthView
          mode={authPortalMode}
          onSwitchMode={(m) => setAuthPortalMode(m)}
          onBackHome={() => {
            if (window.location.search) {
              try {
                window.history.replaceState({}, '', window.location.pathname);
              } catch {
                // ignore
              }
            }
            setAuthPortalMode(null);
          }}
        />
      );
    }
    return (
      <LandingPage
        onOpenStudentLogin={() => setAuthPortalMode('student')}
        onOpenAdminLogin={() => setAuthPortalMode('admin')}
        onOpenAdminRegister={() => setAuthPortalMode('admin_register')}
      />
    );
  }

  // Active CBT Exam Runner
  if (activeSession) {
    return (
      <CbtExamRunner
        exam={activeSession.exam}
        attempt={activeSession.attempt}
        onExitCompleted={() => setActiveSession(null)}
      />
    );
  }

  // Admin Portal (unless Admin explicitly clicked "Lihat Portal Siswa")
  if (isAuthenticatedAdmin && !adminViewingStudentPortal) {
    return (
      <AdminDashboard
        onOpenStudentPreview={() => setAdminViewingStudentPortal(true)}
      />
    );
  }

  // Student Dashboard (also accessible as preview by Admin)
  if (isAuthenticatedStudent || isAuthenticatedAdmin) {
    return (
      <StudentDashboard
        onStartOrResumeAttempt={(exam, attempt) =>
          setActiveSession({ exam, attempt })
        }
        onOpenAdminDashboard={
          isAuthenticatedAdmin
            ? () => setAdminViewingStudentPortal(false)
            : undefined
        }
      />
    );
  }

  return (
    <AuthView
      mode={authPortalMode || 'student'}
      onSwitchMode={(m) => setAuthPortalMode(m)}
      onBackHome={() => setAuthPortalMode(null)}
    />
  );
};

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
