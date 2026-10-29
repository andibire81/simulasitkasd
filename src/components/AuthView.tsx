import React, { useState } from 'react';
import { ArrowLeft, AlertCircle, LogIn, KeyRound, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AppFooter } from './AppFooter';

interface AuthViewProps {
  mode: 'student' | 'admin';
  onSwitchMode: (mode: 'student' | 'admin') => void;
  onBackHome: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ mode, onSwitchMode, onBackHome }) => {
  const {
    authError,
    clearAuthError,
    signInStudentWithNameAndToken,
    signInWithGoogle,
    signInWithCredentials,
  } = useAuth();

  const [busy, setBusy] = useState(false);

  // Student login fields (Name + Token only — no email)
  const [studentName, setStudentName] = useState('');
  const [tokenCode, setTokenCode] = useState('');

  // Optional Admin password method
  const [showAdminPasswordMethod, setShowAdminPasswordMethod] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    if (!studentName.trim() || !tokenCode.trim()) return;
    setBusy(true);
    try {
      await signInStudentWithNameAndToken(studentName, tokenCode);
    } finally {
      setBusy(false);
    }
  };

  const handleAdminGoogleSignIn = async () => {
    clearAuthError();
    setBusy(true);
    try {
      await signInWithGoogle();
    } finally {
      setBusy(false);
    }
  };

  const handleAdminCredentialSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    if (!adminEmail.trim() || !adminPassword.trim()) return;
    setBusy(true);
    try {
      await signInWithCredentials(adminEmail, adminPassword);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={onBackHome}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          SIMULASI TKA SD
        </button>

        <div className="hidden sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              clearAuthError();
              onSwitchMode('student');
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'student'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Masuk Siswa
          </button>
          <button
            type="button"
            onClick={() => {
              clearAuthError();
              onSwitchMode('admin');
            }}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'admin'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Masuk Admin
          </button>
        </div>

        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Beranda
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 md:p-8">
          <p className="text-xs font-semibold text-sky-800">
            {mode === 'student'
              ? 'Portal Peserta Ujian Kelas VI SD'
              : 'Portal Pengawas & Administrator'}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {mode === 'student' ? 'Masuk Peserta Ujian' : 'Masuk Administrator'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            {mode === 'student'
              ? 'Siswa masuk tanpa email — cukup ketikkan Nama Lengkap dan Token Ujian setelah didata oleh Guru/Admin.'
              : 'Khusus guru dan pengawas yang terdaftar sebagai administrator sistem CBT.'}
          </p>

          {/* Mobile role switch */}
          <div className="mt-4 flex sm:hidden items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                onSwitchMode('student');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md ${
                mode === 'student' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Siswa
            </button>
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                onSwitchMode('admin');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md ${
                mode === 'admin' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Administrator
            </button>
          </div>

          {authError && (
            <div className="mt-5 p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {mode === 'student' ? (
            <form onSubmit={handleStudentSubmit} className="mt-5 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1">
                <p className="font-semibold text-slate-900">
                  Ketentuan Masuk Peserta Ujian:
                </p>
                <ol className="list-decimal pl-4 space-y-0.5 text-slate-600">
                  <li>
                    Nama Lengkap siswa <strong>sudah didata terlebih dahulu</strong> oleh Guru/Admin pada menu Data Siswa.
                  </li>
                  <li>
                    Siswa <strong>sudah diberikan Token Ujian aktif</strong> oleh Guru/Admin.
                  </li>
                </ol>
              </div>

              <div>
                <label
                  htmlFor="student-full-name"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Nama Lengkap Siswa
                </label>
                <input
                  id="student-full-name"
                  type="text"
                  required
                  autoComplete="name"
                  maxLength={120}
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="Ketik nama lengkap sesuai pendataan Admin"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <label
                  htmlFor="student-token-code"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Token Ujian dari Admin
                </label>
                <input
                  id="student-token-code"
                  type="text"
                  required
                  autoComplete="off"
                  maxLength={16}
                  value={tokenCode}
                  onChange={(e) =>
                    setTokenCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    )
                  }
                  placeholder="Contoh: K7M4P9"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-lg font-bold font-mono-tabular uppercase tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Masukkan kode Token Ujian yang diberikan oleh Guru/Pengawas ruang ujian.
                </p>
              </div>

              <button
                type="submit"
                disabled={busy || !studentName.trim() || tokenCode.length < 4}
                className="w-full min-h-[48px] px-5 py-3 rounded-lg bg-sky-700 text-white text-base font-semibold hover:bg-sky-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                <UserCheck className="w-5 h-5" />
                <span>
                  {busy ? 'Memeriksa Data & Token...' : 'Masuk Ruang Ujian'}
                </span>
              </button>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                disabled={busy}
                onClick={handleAdminGoogleSignIn}
                className="w-full min-h-[48px] px-5 py-3 rounded-lg bg-sky-700 text-white text-base font-semibold hover:bg-sky-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2.5 whitespace-nowrap shrink-0"
              >
                <LogIn className="w-5 h-5" />
                <span>
                  {busy ? 'Memproses Autentikasi...' : 'Masuk Admin dengan Google'}
                </span>
              </button>

              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdminPasswordMethod((v) => !v)}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {showAdminPasswordMethod
                    ? 'Sembunyikan masuk menggunakan Email & Kata Sandi Admin'
                    : 'Gunakan Email & Kata Sandi Admin (opsional)'}
                </button>

                {showAdminPasswordMethod && (
                  <form onSubmit={handleAdminCredentialSignIn} className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Email Administrator
                      </label>
                      <input
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="nama.guru@guru.sd.belajar.id"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Kata Sandi
                      </label>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Masukkan kata sandi"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 px-4 rounded-lg border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                    >
                      Masuk dengan Kata Sandi
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
};
