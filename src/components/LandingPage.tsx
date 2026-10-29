import React, { useState } from 'react';
import { BookOpen, ShieldCheck, CheckCircle2, Clock, Wifi, HelpCircle, X } from 'lucide-react';
import { AppFooter } from './AppFooter';

interface LandingPageProps {
  onOpenStudentLogin: () => void;
  onOpenAdminLogin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenStudentLogin,
  onOpenAdminLogin,
}) => {
  const [showGuideModal, setShowGuideModal] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
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
          <button
            type="button"
            onClick={() => setShowGuideModal(true)}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Petunjuk Penggunaan
          </button>
          <a
            href="#tentang"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Tentang Aplikasi
          </a>
          <button
            type="button"
            onClick={onOpenAdminLogin}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Portal Admin
          </button>
        </nav>

        <div className="flex items-center shrink-0">
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
              Computer Based Test (CBT) Online · Kelas VI Sekolah Dasar
            </p>
            <h1
              className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              SIMULASI TKA SD
            </h1>
            <p className="mt-2 text-xl md:text-2xl font-medium text-slate-700">
              Computer Based Test (CBT) Online
            </p>
            <p className="mt-5 text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Sistem latihan dan simulasi ujian Tes Kemampuan Akademik (TKA) berbasis komputer
              bagi siswa kelas VI Sekolah Dasar. Dapat diakses dengan nyaman melalui komputer,
              laptop, tablet, maupun telepon genggam.
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
                onClick={() => setShowGuideModal(true)}
                className="min-h-[46px] px-5 py-3 rounded-lg bg-transparent text-slate-700 text-base font-medium hover:bg-slate-200/60 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <HelpCircle className="w-4 h-4 text-slate-600" />
                Petunjuk Penggunaan
              </button>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Informasi: Aplikasi ini digunakan khusus untuk kegiatan latihan dan simulasi
              ujian sekolah secara terarah dan terawasi.
            </p>
          </div>
        </section>

        {/* Clean Feature & Readiness Overview (Single-level elevation, hairline divider) */}
        <section className="border-t border-slate-200 bg-white py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-xl font-bold text-slate-900 mb-6">
              Kelengkapan Pelaksanaan Simulasi CBT
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60">
                <BookOpen className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Soal Sesuai Dokumen Asli
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Mendukung Pilihan Ganda, Pilihan Ganda Kompleks, dan Benar/Salah lengkap
                  dengan perbesaran gambar asli.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60">
                <Wifi className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Simpan Jawaban Otomatis
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Setiap jawaban langsung tersimpan ke server dan tersinkronisasi kembali jika
                  jaringan sempat terputus.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60">
                <Clock className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Waktu Terkendali Server
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Hitung mundur waktu ujian tetap akurat meskipun halaman dimuat ulang atau
                  dibuka dari perangkat berbeda.
                </p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/60">
                <ShieldCheck className="w-5 h-5 text-sky-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  Keamanan Data Peserta
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Akses terpisah antara peserta dan pengawas/admin dengan perlindungan kunci
                  jawaban serta privasi nilai.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tentang Aplikasi */}
        <section id="tentang" className="border-t border-slate-200 bg-slate-50 py-12 px-6">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold text-slate-900">Tentang Aplikasi</h2>
              <p className="mt-2 text-sm md:text-base text-slate-600 leading-relaxed">
                <strong>SIMULASI TKA SD — CBT ONLINE</strong> dirancang untuk membantu siswa
                kelas VI Sekolah Dasar membiasakan diri menghadapi ujian berbasis komputer
                dengan tampilan soal yang jernih, navigasi nomor soal yang mudah dipahami, dan
                pengelolaan administrasi nilai yang akurat bagi guru.
              </p>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 bg-white shrink-0 md:min-w-[300px]">
              <p className="text-xs text-slate-500">Nama Aplikasi</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">
                SIMULASI TKA SD — CBT ONLINE
              </p>
              <div className="my-3 border-t border-slate-100" />
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
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-700 leading-relaxed">
              <div className="space-y-2.5">
                <p className="font-semibold text-slate-900">Panduan Bagi Siswa Peserta Ujian:</p>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>
                    Pastikan Guru/Admin sudah mendata <strong>Nama Lengkap</strong> Anda dan
                    memberikan <strong>Token Ujian</strong> terlebih dahulu, lalu tekan{' '}
                    <strong>Masuk Siswa</strong> dan masukkan Nama Lengkap beserta Token tersebut
                    (tanpa email).
                  </li>
                  <li>
                    Periksa nama lengkap, nomor peserta, kelas, dan asal sekolah pada halaman
                    Dashboard Siswa.
                  </li>
                  <li>
                    Pilih simulasi ujian yang berstatus <strong>Tersedia</strong>, baca halaman
                    petunjuk ujian, centang pernyataan kesiapan, lalu tekan{' '}
                    <strong>MULAI UJIAN</strong>.
                  </li>
                  <li>
                    Perhatikan jenis soal:
                    <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-600">
                      <li>
                        <strong>Pilihan Ganda Satu Jawaban:</strong> Pilih satu huruf jawaban
                        yang paling tepat.
                      </li>
                      <li>
                        <strong>Pilihan Ganda Kompleks:</strong> Centang lebih dari satu
                        pernyataan yang benar sesuai instruksi soal.
                      </li>
                      <li>
                        <strong>Benar atau Salah:</strong> Pilih Benar atau Salah pada setiap
                        baris pernyataan.
                      </li>
                    </ul>
                  </li>
                  <li>
                    Tekan tombol <strong>Perbesar Gambar</strong> pada diagram, tabel, atau
                    ilustrasi soal jika ingin melihat detail angka dengan lebih besar.
                  </li>
                  <li>
                    Pastikan indikator penyimpanan di bagian atas tertulis{' '}
                    <strong>Tersimpan di Server</strong> sebelum menekan{' '}
                    <strong>KUMPULKAN UJIAN</strong>.
                  </li>
                </ol>
              </div>
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Siap digunakan pada komputer, tablet, dan telepon genggam.</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowGuideModal(false);
                    onOpenStudentLogin();
                  }}
                  className="px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 whitespace-nowrap shrink-0"
                >
                  Lanjut Masuk Siswa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
