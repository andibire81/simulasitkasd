import React, { useState } from 'react';
import {
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  HelpCircle,
  ShieldCheck,
  UserPlus,
  Wifi,
  X,
} from 'lucide-react';
import { AppFooter } from './AppFooter';

interface LandingPageProps {
  onOpenStudentLogin: () => void;
  onOpenAdminLogin: () => void;
  onOpenAdminRegister: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenStudentLogin,
  onOpenAdminLogin,
  onOpenAdminRegister,
}) => {
  const [showGuideModal, setShowGuideModal] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-6 px-6 py-4 bg-white border-b border-slate-200">
        <a
          href="#beranda"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          SIMULASI TKA SD
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#beranda"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Beranda
          </a>
          <a
            href="#sekolah-lain"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Untuk Sekolah Lain
          </a>
          <button
            type="button"
            onClick={() => setShowGuideModal(true)}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Petunjuk Penggunaan
          </button>
          <button
            type="button"
            onClick={onOpenAdminLogin}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Portal Admin
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenAdminRegister}
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 text-sky-700" />
            Daftar Admin Sekolah
          </button>
          <button
            type="button"
            onClick={onOpenStudentLogin}
            className="px-4 py-2 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 transition-colors whitespace-nowrap shrink-0"
          >
            Masuk Siswa
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main id="beranda" className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-14 pb-12 md:pt-20 md:pb-16">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-sky-800 mb-3">
              Computer Based Test (CBT) Online · Kelas VI Sekolah Dasar · Matematika &amp; Bahasa Indonesia
            </p>
            <h1
              className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              SIMULASI TKA SD
            </h1>
            <p className="mt-2 text-xl md:text-2xl font-medium text-slate-700">
              Computer Based Test (CBT) Online Terbuka Antar-Sekolah
            </p>
            <p className="mt-5 text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Sistem latihan dan simulasi ujian Tes Kemampuan Akademik (TKA) berbasis komputer
              bagi siswa kelas VI Sekolah Dasar. Dapat digunakan oleh banyak Sekolah Dasar secara
              mandiri melalui komputer, laptop, tablet, maupun telepon genggam.
            </p>

            {/* Primary & Secondary Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenStudentLogin}
                className="min-h-[46px] px-6 py-3 rounded-lg bg-sky-700 text-white text-base font-semibold hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 transition-colors whitespace-nowrap shrink-0"
              >
                Masuk Siswa
              </button>
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="min-h-[46px] px-5 py-3 rounded-lg bg-white border border-slate-300 text-slate-800 text-base font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                Masuk Admin
              </button>
              <button
                type="button"
                onClick={onOpenAdminRegister}
                className="min-h-[46px] px-5 py-3 rounded-lg bg-slate-900 text-white text-base font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                Daftar Admin Sekolah Baru
              </button>
              <button
                type="button"
                onClick={() => setShowGuideModal(true)}
                className="min-h-[46px] px-4 py-3 rounded-lg bg-transparent text-slate-700 text-base font-medium hover:bg-slate-200/60 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <HelpCircle className="w-4 h-4 text-slate-600" />
                Petunjuk Penggunaan
              </button>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Guru atau Operator dari sekolah lain dapat langsung mendaftar menjadi Admin Sekolah
              menggunakan akun Google atau Belajar.id tanpa biaya.
            </p>
          </div>
        </section>

        {/* Multi-School Onboarding Section */}
        <section id="sekolah-lain" className="border-t border-slate-200 bg-white py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
                  Dukungan Multi-Sekolah
                </p>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
                  Gunakan Aplikasi Ini untuk Sekolah Dasar Anda
                </h2>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                  Setiap sekolah memiliki ruang pengelolaan siswa, token ujian, jadwal sesi, dan
                  rekapitulasi nilai tersendiri tanpa bercampur dengan sekolah lain.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenAdminRegister}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0 self-start md:self-auto"
              >
                <Building2 className="w-4 h-4" />
                Daftarkan Sekolah Sekarang
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-xs font-mono-tabular font-semibold text-sky-800">
                  LANGKAH 01
                </div>
                <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                  Daftar dengan Akun Google
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Klik Daftar Admin Sekolah Baru, masuk menggunakan akun Belajar.id atau Gmail,
                  lalu isi Nama Lengkap Guru dan Nama Sekolah Dasar Anda.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-xs font-mono-tabular font-semibold text-sky-800">
                  LANGKAH 02
                </div>
                <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                  Data Siswa &amp; Aktifkan Ujian
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Gunakan langsung 60 soal TKA terverifikasi (Matematika &amp; Bahasa Indonesia)
                  atau unggah PDF soal tambahan, lalu tambahkan siswa sekolah Anda dan bagikan Token.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-xs font-mono-tabular font-semibold text-sky-800">
                  LANGKAH 03
                </div>
                <h3 className="mt-1.5 text-base font-semibold text-slate-900">
                  Koreksi &amp; Cetak Nilai Otomatis
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Siswa mengerjakan ujian cukup dengan Nama Lengkap + Token (tanpa email). Nilai
                  dikoreksi otomatis dan siap diunduh per sekolah.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Clean Feature & Readiness Overview */}
        <section className="border-t border-slate-200 bg-slate-50 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-xl font-bold text-slate-900 mb-6">
              Kelengkapan Pelaksanaan Simulasi CBT
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-5 rounded-xl border border-slate-200 bg-white">
                <BookOpen className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Soal Sesuai Dokumen Asli
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Mendukung Pilihan Ganda, Pilihan Ganda Kompleks, dan Benar/Salah lengkap
                  dengan perbesaran gambar asli.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white">
                <Wifi className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Simpan Jawaban Otomatis
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Setiap jawaban langsung tersimpan ke server dan tersinkronisasi kembali jika
                  jaringan sempat terputus.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white">
                <Clock className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Waktu Terkendali Server
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Hitung mundur waktu ujian tetap akurat meskipun halaman dimuat ulang atau
                  dibuka dari perangkat berbeda.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-white">
                <ShieldCheck className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Pemisahan Data Sekolah
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Daftar peserta, token masuk, jadwal ujian, dan laporan nilai terkelola rapi
                  sesuai asal sekolah masing-masing.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tentang Aplikasi */}
        <section id="tentang" className="border-t border-slate-200 bg-white py-12 px-6">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold text-slate-900">Tentang Aplikasi</h2>
              <p className="mt-2 text-sm md:text-base text-slate-600 leading-relaxed">
                <strong>SIMULASI TKA SD — CBT ONLINE</strong> dirancang untuk membantu siswa
                kelas VI Sekolah Dasar membiasakan diri menghadapi ujian berbasis komputer
                dengan tampilan soal yang jernih, navigasi nomor soal yang mudah dipahami, dan
                pengelolaan administrasi nilai yang akurat bagi guru di berbagai sekolah.
              </p>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 shrink-0 md:min-w-[300px]">
              <p className="text-xs text-slate-500">Nama Aplikasi</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">
                SIMULASI TKA SD — CBT ONLINE
              </p>
              <div className="my-3 border-t border-slate-200" />
              <p className="text-xs text-slate-500">Dikembangkan oleh</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">
                Andi Mozes Leavingstone Bire, S.Pd.
              </p>
            </div>
          </div>
        </section>
      </main>

      <AppFooter />

      {/* Petunjuk Penggunaan Modal */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-modal-title"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="guide-modal-title" className="text-lg font-bold text-slate-900">
                Petunjuk Penggunaan Aplikasi
              </h2>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                aria-label="Tutup petunjuk"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed">
              <div className="space-y-2.5">
                <p className="font-semibold text-slate-900">
                  A. Panduan Bagi Siswa Peserta Ujian:
                </p>
                <ol className="list-decimal pl-5 space-y-1.5">
                  <li>
                    Pastikan Guru/Admin Sekolah Anda sudah mendata <strong>Nama Lengkap</strong>{' '}
                    dan memberikan <strong>Token Ujian</strong>, lalu tekan{' '}
                    <strong>Masuk Siswa</strong> (tanpa email).
                  </li>
                  <li>
                    Periksa identitas nama lengkap, nomor peserta, kelas, dan asal sekolah pada
                    Dashboard Siswa.
                  </li>
                  <li>
                    Pilih simulasi ujian yang berstatus <strong>Tersedia</strong>, centang
                    pernyataan kesiapan, lalu tekan <strong>MULAI UJIAN</strong>.
                  </li>
                  <li>
                    Pastikan status di bagian atas tertulis <strong>Tersimpan di Server</strong>{' '}
                    sebelum menekan <strong>KUMPULKAN UJIAN</strong>.
                  </li>
                </ol>
              </div>

              <div className="pt-4 border-t border-slate-200 space-y-2.5">
                <p className="font-semibold text-slate-900">
                  B. Panduan Pendaftaran Guru / Admin Sekolah Lain:
                </p>
                <ol className="list-decimal pl-5 space-y-1.5">
                  <li>
                    Tekan tombol <strong>Daftar Admin Sekolah Baru</strong> pada halaman utama.
                  </li>
                  <li>
                    Masuk menggunakan akun Google terverifikasi (mendukung akun{' '}
                    <strong>belajar.id</strong> maupun Gmail pribadi).
                  </li>
                  <li>
                    Isi <strong>Nama Lengkap Guru</strong>, <strong>Nama Sekolah Dasar</strong>,
                    dan <strong>Jabatan</strong>, lalu simpan untuk langsung membuka Dashboard
                    Admin Sekolah Anda.
                  </li>
                  <li>
                    Buka menu <strong>Data Siswa</strong> untuk mendata nama peserta dan
                    membagikan Token, lalu buka <strong>Pengaturan Ujian</strong> untuk
                    mengaktifkan jadwal ujian bagi sekolah Anda.
                  </li>
                </ol>
              </div>

              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Siap digunakan pada komputer, tablet, dan telepon genggam.</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuideModal(false);
                      onOpenAdminRegister();
                    }}
                    className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Daftar Admin Sekolah
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuideModal(false);
                      onOpenStudentLogin();
                    }}
                    className="px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 whitespace-nowrap shrink-0"
                  >
                    Masuk Siswa
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
