import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { canUseAuthRedirect, useAuth } from '../context/AuthContext';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  FIREBASE_CONSOLE_AUTH_SETTINGS_URL,
  FIREBASE_PROJECT_ID,
} from '../lib/firebase';
import { AppFooter } from './AppFooter';

export type AuthPortalMode = 'student' | 'admin' | 'admin_register';

interface AuthViewProps {
  mode: AuthPortalMode;
  onSwitchMode: (mode: AuthPortalMode) => void;
  onBackHome: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  mode,
  onSwitchMode,
  onBackHome,
}) => {
  const {
    firebaseUser,
    adminRecord,
    adminOnboardingState,
    registrationSettings,
    authError,
    authErrorCode,
    clearAuthError,
    signInStudentWithNameAndToken,
    signInWithGoogle,
    signInWithGoogleRedirect,
    completeSchoolAdminRegistration,
    signInWithCredentials,
    refreshProfile,
    signOut,
  } = useAuth();

  const [busy, setBusy] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const detectedHostname =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'nama-aplikasi.vercel.app';
  const redirectSupported = canUseAuthRedirect();

  // Student login fields (Name + Token only — no email)
  const [studentName, setStudentName] = useState('');
  const [tokenCode, setTokenCode] = useState('');

  // School Admin registration form fields (Step 2 after Google Sign-In)
  const [regFullName, setRegFullName] = useState('');
  const [regSchoolName, setRegSchoolName] = useState('');
  const [regPosition, setRegPosition] = useState('Guru Kelas VI');

  // Optional Admin password method
  const [showAdminPasswordMethod, setShowAdminPasswordMethod] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    if (firebaseUser) {
      setRegFullName((prev) => prev || firebaseUser.displayName || '');
    }
  }, [firebaseUser]);

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
      const res = await signInWithGoogle();
      if (res === 'onboarding') {
        onSwitchMode('admin_register');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAdminGoogleRedirect = async () => {
    clearAuthError();
    setBusy(true);
    try {
      await signInWithGoogleRedirect();
    } finally {
      setBusy(false);
    }
  };

  const handleCopyHostname = async () => {
    try {
      await navigator.clipboard.writeText(detectedHostname);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2200);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setBusy(true);
    try {
      await completeSchoolAdminRegistration({
        fullName: regFullName,
        schoolName: regSchoolName,
        position: regPosition,
      });
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

  const handleCheckPendingStatus = async () => {
    setBusy(true);
    try {
      await refreshProfile();
    } finally {
      setBusy(false);
    }
  };

  const isAdminTab = mode === 'admin' || mode === 'admin_register';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-6 px-6 py-4 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={onBackHome}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          SIMULASI TKA SD
        </button>

        {!firebaseUser && (
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
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                onSwitchMode('admin_register');
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'admin_register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar Admin Sekolah
            </button>
          </div>
        )}

        {firebaseUser ? (
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" />
            Ganti Akun
          </button>
        ) : (
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Beranda
          </button>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-6 md:p-8">
          {/* CASE 1: Signed-in Google User Completing Onboarding / Viewing Status */}
          {firebaseUser && adminOnboardingState === 'pending_approval' ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5 text-amber-800">
                <Clock className="w-5 h-5 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Menunggu Persetujuan Admin Utama
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  Pendaftaran Sekolah Diterima
                </h1>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Data pendaftaran Admin Sekolah Anda telah tercatat. Saat ini sistem sedang
                  menggunakan mode persetujuan manual oleh Administrator Utama.
                </p>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Nama Guru / Admin</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {adminRecord?.fullName || firebaseUser.displayName}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Asal Sekolah</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {adminRecord?.schoolName || '-'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Email Google</span>
                  <span className="font-mono-tabular text-xs text-slate-700 text-right">
                    {firebaseUser.email}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCheckPendingStatus}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-60 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                  Periksa Status Persetujuan
                </button>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Keluar
                </button>
              </div>
            </div>
          ) : firebaseUser && adminOnboardingState === 'suspended' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Akses Admin Dinonaktifkan
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                Akun Admin Sekolah Sedang Nonaktif
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Hak akses Administrator untuk akun <strong>{firebaseUser.email}</strong> (
                {adminRecord?.schoolName || 'Sekolah'}) sedang dinonaktifkan sementara oleh
                Administrator Utama.
              </p>
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Keluar Akun
              </button>
            </div>
          ) : firebaseUser && adminOnboardingState === 'needs_registration' ? (
            <div>
              <p className="text-xs font-semibold text-sky-800">
                Langkah 2 dari 2 · Pendaftaran Admin Sekolah Baru
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                Lengkapi Identitas Sekolah Anda
              </h1>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Akun Google <strong>{firebaseUser.email}</strong> telah terverifikasi. Isi nama
                sekolah Anda di bawah ini untuk membuat ruang pengelolaan siswa dan ujian.
              </p>

              {authError && (
                <div className="mt-4 p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {registrationSettings.mode === 'closed' ? (
                <div className="mt-5 space-y-4">
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
                    Mohon maaf, pendaftaran mandiri Admin Sekolah baru sedang ditutup sementara
                    oleh Administrator Utama.
                  </div>
                  <button
                    type="button"
                    onClick={() => signOut()}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Kembali &amp; Keluar Akun
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCompleteRegistration} className="mt-5 space-y-4">
                  <div>
                    <label
                      htmlFor="reg-full-name"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Nama Lengkap Guru / Admin (Beserta Gelar)
                    </label>
                    <input
                      id="reg-full-name"
                      type="text"
                      required
                      maxLength={120}
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      placeholder="Contoh: Ibu Siti Aminah, S.Pd."
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reg-school-name"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Nama Sekolah Dasar
                    </label>
                    <input
                      id="reg-school-name"
                      type="text"
                      required
                      maxLength={120}
                      value={regSchoolName}
                      onChange={(e) => setRegSchoolName(e.target.value)}
                      placeholder="Contoh: UPTD SD Negeri 1 Kupang"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Nama sekolah ini akan otomatis tercantum pada kartu peserta, jadwal ujian,
                      dan laporan rekap nilai sekolah Anda.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-position"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Jabatan / Peran di Sekolah
                    </label>
                    <select
                      id="reg-position"
                      value={regPosition}
                      onChange={(e) => setRegPosition(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="Guru Kelas VI">Guru Kelas VI</option>
                      <option value="Proktor / Operator CBT Sekolah">
                        Proktor / Operator CBT Sekolah
                      </option>
                      <option value="Kepala Sekolah">Kepala Sekolah</option>
                      <option value="Guru Sekolah Dasar">Guru Sekolah Dasar</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      busy || regFullName.trim().length < 2 || regSchoolName.trim().length < 3
                    }
                    className="w-full min-h-[48px] px-5 py-3 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Building2 className="w-4 h-4" />
                    <span>
                      {busy
                        ? 'Menyiapkan Ruang Sekolah...'
                        : registrationSettings.mode === 'approval'
                        ? 'Kirim Pendaftaran Admin Sekolah'
                        : 'Aktifkan Admin Sekolah & Buka Dashboard'}
                    </span>
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* CASE 2: Standard Student Login / Admin Login / Admin Registration Intro */
            <>
              <p className="text-xs font-semibold text-sky-800">
                {mode === 'student'
                  ? 'Portal Peserta Ujian Kelas VI SD'
                  : mode === 'admin_register'
                  ? 'Pendaftaran Guru & Sekolah Lain'
                  : 'Portal Pengawas & Administrator Sekolah'}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                {mode === 'student'
                  ? 'Masuk Peserta Ujian'
                  : mode === 'admin_register'
                  ? 'Daftar Admin Sekolah Baru'
                  : 'Masuk Administrator'}
              </h1>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                {mode === 'student'
                  ? 'Siswa masuk tanpa email — cukup ketikkan Nama Lengkap dan Token Ujian setelah didata oleh Guru/Admin Sekolah.'
                  : mode === 'admin_register'
                  ? registrationSettings.welcomeNote ||
                    'Daftarkan Sekolah Dasar Anda menggunakan akun Google (Belajar.id atau Gmail) untuk menyelenggarakan simulasi TKA SD.'
                  : 'Masuk untuk mengelola data siswa, token ujian, jadwal sesi, dan rekap nilai sekolah Anda.'}
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
                    mode === 'student'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
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
                    mode === 'admin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Masuk Admin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    onSwitchMode('admin_register');
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md ${
                    mode === 'admin_register'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Daftar Sekolah
                </button>
              </div>

              {authError && (
                <div className="mt-5 space-y-3">
                  <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>

                  {authErrorCode === 'auth/unauthorized-domain' && (
                    <div className="p-4 rounded-lg border border-amber-300 bg-amber-50/80 text-xs text-slate-800 space-y-3">
                      <div className="font-bold text-amber-950 text-sm">
                        Cara Mengaktifkan Login Google untuk Domain Vercel (Cukup 1 Kali):
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 px-3 py-2 rounded-md bg-white border border-amber-300 font-mono-tabular text-xs font-semibold text-slate-900 select-all break-all">
                          {detectedHostname}
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyHostname}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          {copiedDomain ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              Domain Tersalin
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              1. Salin Domain Ini
                            </>
                          )}
                        </button>
                      </div>

                      <ol className="list-decimal pl-4 space-y-1.5 text-slate-700 leading-relaxed">
                        <li>
                          Buka pengaturan Firebase proyek{' '}
                          <code className="font-mono-tabular font-semibold text-slate-900">
                            {FIREBASE_PROJECT_ID}
                          </code>{' '}
                          menggunakan akun pemilik (
                          <span className="font-mono-tabular font-semibold text-slate-900">
                            {BOOTSTRAPPED_ADMIN_EMAIL}
                          </span>
                          ).
                        </li>
                        <li>
                          Pada tab <strong>Settings &rarr; Authorized domains</strong> (Domain
                          resmi), klik <strong>Add domain</strong> lalu tempel{' '}
                          <code className="font-mono-tabular font-semibold text-slate-900">
                            {detectedHostname}
                          </code>{' '}
                          dan simpan.
                        </li>
                        <li>
                          Kembali ke halaman ini, lalu klik tombol{' '}
                          <strong>Daftar / Masuk dengan Akun Google</strong> di bawah (tidak perlu
                          deploy ulang di Vercel).
                        </li>
                      </ol>

                      <div className="pt-1">
                        <a
                          href={FIREBASE_CONSOLE_AUTH_SETTINGS_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 whitespace-nowrap"
                        >
                          <span>2. Buka Authorized Domains di Firebase Console</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isAdminTab ? (
                <form onSubmit={handleStudentSubmit} className="mt-5 space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1">
                    <p className="font-semibold text-slate-900">
                      Ketentuan Masuk Peserta Ujian:
                    </p>
                    <ol className="list-decimal pl-4 space-y-0.5 text-slate-600">
                      <li>
                        Nama Lengkap siswa <strong>sudah didata terlebih dahulu</strong> oleh
                        Guru/Admin Sekolah pada menu Data Siswa.
                      </li>
                      <li>
                        Siswa <strong>sudah diberikan Token Ujian aktif</strong> oleh Guru/Admin
                        Sekolah.
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
                      placeholder="Ketik nama lengkap sesuai pendataan Guru/Admin"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="student-token-code"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Token Ujian dari Guru / Admin
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
                      Masukkan kode Token Ujian yang diberikan oleh Guru/Pengawas sekolah Anda.
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
              ) : mode === 'admin_register' ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs text-slate-700">
                    <div className="font-semibold text-slate-900">
                      Fasilitas untuk Setiap Admin Sekolah:
                    </div>
                    <ul className="space-y-1.5 text-slate-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          Siap pakai 60 soal TKA Kelas VI (30 Matematika &amp; 30 Bahasa Indonesia)
                          beserta kunci jawaban &amp; koreksi otomatis AI.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          Daftar siswa, token masuk, jadwal ujian, dan laporan nilai terpisah
                          rapi khusus untuk sekolah Anda.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                        <span>
                          {registrationSettings.mode === 'open'
                            ? 'Pendaftaran terbuka: akun Admin Sekolah langsung aktif setelah mengisi Nama Sekolah.'
                            : registrationSettings.mode === 'approval'
                            ? 'Mode persetujuan aktif: pendaftaran akan diverifikasi oleh Admin Utama.'
                            : 'Pendaftaran mandiri baru sedang ditutup sementara.'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  {registrationSettings.mode === 'closed' ? (
                    <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                      Pendaftaran mandiri Admin Sekolah baru sedang ditutup sementara. Jika akun
                      Anda sudah terdaftar sebelumnya, gunakan menu Masuk Admin.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleAdminGoogleSignIn}
                        className="w-full min-h-[48px] px-5 py-3 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-2.5 whitespace-nowrap shrink-0"
                      >
                        <UserPlus className="w-5 h-5" />
                        <span>
                          {busy
                            ? 'Menghubungkan Akun Google...'
                            : 'Daftar dengan Akun Google / Belajar.id'}
                        </span>
                      </button>

                      {redirectSupported && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleAdminGoogleRedirect}
                          className="w-full py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
                        >
                          Pop-up tidak muncul di HP/peramban? Daftar via Mode Alih Halaman
                        </button>
                      )}
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 text-center text-xs text-slate-600">
                    Sudah terdaftar sebagai Admin Sekolah?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        clearAuthError();
                        onSwitchMode('admin');
                      }}
                      className="font-semibold text-sky-800 hover:underline"
                    >
                      Masuk di sini
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="space-y-2.5">
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

                    {redirectSupported && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleAdminGoogleRedirect}
                        className="w-full py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
                      >
                        Pop-up tidak muncul di HP/peramban? Masuk via Mode Alih Halaman
                      </button>
                    )}
                  </div>

                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      Guru dari sekolah lain &amp; belum punya akses Admin?
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        clearAuthError();
                        onSwitchMode('admin_register');
                      }}
                      className="px-3 py-1.5 rounded-md bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      Daftar Admin Sekolah
                    </button>
                  </div>

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
            </>
          )}
        </div>
      </main>

      <AppFooter />
    </div>
  );
};
