import React, { useEffect, useState } from 'react';
import {
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Play,
  FileText,
  LogOut,
  Shield,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  AttemptRecord,
  AttemptStatus,
  ExamRecord,
  ExamStatus,
  normalizeSchoolName,
  QuestionRecord,
  ResponseRecord,
} from '../types/cbt';
import { getAuthoritativeNowMs, syncServerClock } from '../lib/serverClock';
import { AppFooter } from './AppFooter';

interface StudentDashboardProps {
  onStartOrResumeAttempt: (exam: ExamRecord, attempt: AttemptRecord) => void;
  onOpenAdminDashboard?: () => void;
}

function deterministicShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function getStoredRetakeAttemptIds(studentUid: string): string[] {
  try {
    const raw = localStorage.getItem(`cbt_retake_ids_${studentUid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function appendStoredRetakeAttemptId(studentUid: string, attemptId: string): void {
  try {
    const existing = getStoredRetakeAttemptIds(studentUid);
    if (!existing.includes(attemptId)) {
      localStorage.setItem(
        `cbt_retake_ids_${studentUid}`,
        JSON.stringify([...existing, attemptId].slice(-30))
      );
    }
  } catch {
    // ignore storage quota warning
  }
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  onStartOrResumeAttempt,
  onOpenAdminDashboard,
}) => {
  const { profile, studentSession, isAdmin, signOut } = useAuth();
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExamForInstructions, setSelectedExamForInstructions] =
    useState<ExamRecord | null>(null);
  const [readyConfirmed, setReadyConfirmed] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [resumingExamId, setResumingExamId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [portalBannerError, setPortalBannerError] = useState<string | null>(null);

  useEffect(() => {
    syncServerClock();
  }, []);

  // 1. Subscribe to /cbtPortal/publishedExams and load published exams via deterministic getDoc
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    const unsubPortal = onSnapshot(
      doc(db, 'cbtPortal', 'publishedExams'),
      async (portalSnap) => {
        const examIds = portalSnap.exists()
          ? ((portalSnap.data()?.examIds as string[]) || [])
          : [];

        if (examIds.length === 0) {
          if (!cancelled) {
            setExams([]);
            setLoading(false);
          }
          return;
        }

        const fetchedExams = await Promise.all(
          examIds.map(async (examId) => {
            try {
              const exSnap = await getDoc(doc(db, 'exams', examId));
              if (!exSnap.exists()) return null;
              return exSnap.data() as ExamRecord;
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        const filtered = fetchedExams
          .filter((ex): ex is ExamRecord => Boolean(ex))
          .filter(
            (ex) =>
              ex.status === ExamStatus.WAITING ||
              ex.status === ExamStatus.ACTIVE ||
              ex.status === ExamStatus.FINISHED
          )
          .filter(
            (ex) =>
              !ex.schoolName ||
              ex.schoolName === 'Semua' ||
              normalizeSchoolName(ex.schoolName) ===
                normalizeSchoolName(profile.schoolName) ||
              profile.className === 'ADMIN'
          )
          .filter(
            (ex) =>
              ex.targetClass === 'Semua' ||
              ex.targetClass.toLowerCase() === profile.className.toLowerCase() ||
              profile.className === 'ADMIN'
          )
          .sort((a, b) => {
            const ta = a.scheduledStart?.toMillis?.() || 0;
            const tb = b.scheduledStart?.toMillis?.() || 0;
            return tb - ta;
          });

        setExams(filtered);
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'cbtPortal/publishedExams')
    );

    return () => {
      cancelled = true;
      unsubPortal();
    };
  }, [profile]);

  // 2. Subscribe to deterministic student attempt docs (`${exam.id}_${profile.uid}` + any local retake IDs)
  useEffect(() => {
    if (!profile) return;

    const candidateIds = new Set<string>();
    exams.forEach((ex) => {
      candidateIds.add(`${ex.id}_${profile.uid}`);
    });
    getStoredRetakeAttemptIds(profile.uid).forEach((id) => candidateIds.add(id));

    if (candidateIds.size === 0) {
      setAttempts([]);
      return;
    }

    const byId = new Map<string, AttemptRecord>();
    const recomputeList = () => {
      const sorted = Array.from(byId.values()).sort(
        (a, b) => (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0)
      );
      setAttempts(sorted);
    };

    const unsubs = Array.from(candidateIds).map((attId) =>
      onSnapshot(
        doc(db, 'attempts', attId),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as AttemptRecord;
            if (data.studentUid === profile.uid) {
              byId.set(attId, data);
            }
          } else {
            byId.delete(attId);
          }
          recomputeList();
        },
        (err) => {
          console.warn('Attempt snapshot warning:', err);
        }
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [exams, profile]);

  if (!profile) return null;

  const getExamStudentState = (exam: ExamRecord) => {
    const nowMs = getAuthoritativeNowMs();
    const myAttempts = attempts.filter((a) => a.examId === exam.id);
    const activeAttempt = myAttempts.find((a) => a.status === AttemptStatus.IN_PROGRESS);
    const finishedAttempt = myAttempts.find(
      (a) =>
        a.status === AttemptStatus.SUBMITTED || a.status === AttemptStatus.EXPIRED_SUBMITTED
    );

    if (activeAttempt) {
      const expMs = activeAttempt.expiresAt?.toMillis?.() || 0;
      if (expMs > nowMs) {
        return {
          code: 'IN_PROGRESS' as const,
          label: 'SEDANG DIKERJAKAN',
          canStart: true,
          activeAttempt,
          finishedAttempt,
        };
      }
    }

    if (finishedAttempt && !exam.allowRetake) {
      return {
        code: 'COMPLETED' as const,
        label: 'UJIAN SELESAI',
        canStart: false,
        activeAttempt: undefined,
        finishedAttempt,
      };
    }

    if (exam.status === ExamStatus.WAITING) {
      return {
        code: 'NOT_OPEN' as const,
        label: 'BELUM DIBUKA',
        canStart: false,
        activeAttempt: undefined,
        finishedAttempt,
      };
    }

    if (exam.status === ExamStatus.FINISHED) {
      return {
        code: 'CLOSED' as const,
        label: 'UJIAN SELESAI',
        canStart: false,
        activeAttempt: undefined,
        finishedAttempt,
      };
    }

    const startMs = exam.scheduledStart?.toMillis?.() || 0;
    const endMs = exam.scheduledEnd?.toMillis?.() || Number.MAX_SAFE_INTEGER;
    if (startMs > nowMs) {
      return {
        code: 'NOT_OPEN' as const,
        label: 'BELUM DIBUKA',
        canStart: false,
        activeAttempt: undefined,
        finishedAttempt,
      };
    }
    if (nowMs > endMs) {
      return {
        code: 'CLOSED' as const,
        label: 'UJIAN SELESAI',
        canStart: false,
        activeAttempt: undefined,
        finishedAttempt,
      };
    }

    return {
      code: 'AVAILABLE' as const,
      label: 'TERSEDIA',
      canStart: true,
      activeAttempt: undefined,
      finishedAttempt,
    };
  };

  /**
   * Resumes an in-progress attempt, seamlessly migrating saved answers if the student
   * moved to a spare computer and authenticated again with their Name + Active Token.
   */
  const resumeAttemptWithSessionRecovery = async (
    exam: ExamRecord,
    existingAttempt: AttemptRecord
  ) => {
    setPortalBannerError(null);
    if (!studentSession) {
      const msg =
        'Anda sedang membuka Portal Siswa dalam mode pratinjau Administrator. Untuk mengerjakan ujian sebagai siswa, keluar dari akun Admin lalu masuk melalui menu Masuk Siswa menggunakan Nama Siswa dan Token Aktif.';
      setPortalBannerError(msg);
      setActionError(msg);
      return;
    }

    if (existingAttempt.sessionId === studentSession.id) {
      onStartOrResumeAttempt(exam, existingAttempt);
      return;
    }

    setResumingExamId(exam.id);
    try {
      await syncServerClock();

      // 1. Read previously saved answers under the prior sessionId before switching
      const migratedResponses: Record<string, ResponseRecord> = {};
      await Promise.all(
        existingAttempt.questionOrder.map(async (qId) => {
          try {
            const oldDocId = `${existingAttempt.sessionId}_${qId}`;
            const oldSnap = await getDoc(
              doc(db, 'attempts', existingAttempt.id, 'responses', oldDocId)
            );
            if (oldSnap.exists()) {
              const oldData = oldSnap.data() as ResponseRecord;
              migratedResponses[qId] = {
                ...oldData,
                sessionId: studentSession.id,
                clientSequence: (oldData.clientSequence || 1) + 1,
              };
            }
          } catch {
            // Ignore missing response slots
          }
        })
      );

      // 2. Bind attempt to the newly verified capability session (Action 4 in firestore.rules)
      await updateDoc(doc(db, 'attempts', existingAttempt.id), {
        sessionId: studentSession.id,
        updatedAt: serverTimestamp(),
      });

      // 3. Stage migrated answers in local backup so CbtExamRunner flushes them to the new sessionId
      if (Object.keys(migratedResponses).length > 0) {
        try {
          localStorage.setItem(
            `cbt_backup_${existingAttempt.id}`,
            JSON.stringify(migratedResponses)
          );
        } catch {
          // ignore
        }
      }

      onStartOrResumeAttempt(exam, {
        ...existingAttempt,
        sessionId: studentSession.id,
      });
    } catch (err) {
      console.error('Failed recovering student session:', err);
      setPortalBannerError(
        'Gagal melanjutkan sesi ujian pada perangkat ini. Pastikan Token Ujian dari pengawas masih berstatus Aktif, lalu masuk kembali.'
      );
    } finally {
      setResumingExamId(null);
    }
  };

  const handleConfirmStartExam = async () => {
    if (!selectedExamForInstructions || !readyConfirmed) return;
    setActionError(null);

    if (!studentSession) {
      setActionError(
        'Anda sedang membuka Portal Siswa dalam mode pratinjau Administrator. Untuk menguji pengerjaan soal sebagai siswa, keluar dari akun Admin lalu masuk melalui menu Masuk Siswa menggunakan Nama Siswa dan Token Aktif.'
      );
      return;
    }

    setStartingExam(true);

    try {
      await syncServerClock();
      const exam = selectedExamForInstructions;

      const deterministicId = `${exam.id}_${profile.uid}`;
      const attemptId = exam.allowRetake
        ? `${exam.id}_${profile.uid}_${Date.now().toString(36)}`
        : deterministicId;

      if (!exam.allowRetake) {
        const existingSnap = await getDoc(doc(db, 'attempts', deterministicId));
        if (existingSnap.exists()) {
          const existingAttempt = existingSnap.data() as AttemptRecord;
          if (existingAttempt.status === AttemptStatus.IN_PROGRESS) {
            setSelectedExamForInstructions(null);
            await resumeAttemptWithSessionRecovery(exam, existingAttempt);
            return;
          } else {
            setActionError(
              'Anda sudah menyelesaikan ujian ini dan percobaan ulang tidak diizinkan.'
            );
            setStartingExam(false);
            return;
          }
        }
      }

      // Verify questions are verified before starting
      const validIds: string[] = [];
      for (const qId of exam.questionIds) {
        try {
          const qSnap = await getDoc(doc(db, 'questions', qId));
          if (qSnap.exists()) {
            const qData = qSnap.data() as QuestionRecord;
            if (qData.verificationStatus === 'verified') {
              validIds.push(qId);
            }
          }
        } catch {
          // Skip unverified question blocked by security rules
        }
      }

      if (validIds.length === 0) {
        setActionError(
          'Soal pada ujian ini belum diverifikasi oleh pengawas/admin. Silakan hubungi pengawas ujian.'
        );
        setStartingExam(false);
        return;
      }

      const orderedIds = exam.shuffleQuestions
        ? deterministicShuffle(validIds, `${attemptId}_qorder`)
        : validIds;

      const serverNowMs = getAuthoritativeNowMs();
      const examEndMs =
        exam.scheduledEnd?.toMillis?.() || serverNowMs + exam.durationMinutes * 60_000;
      const computedEndMs = Math.min(
        serverNowMs + exam.durationMinutes * 60_000,
        examEndMs
      );
      const safeExpiresMs = Math.max(serverNowMs + 60_000, computedEndMs);

      const newAttemptPayload = {
        id: attemptId,
        examId: exam.id,
        examTitle: exam.title,
        subject: exam.subject,
        studentUid: profile.uid,
        sessionId: studentSession.id,
        studentName: profile.fullName,
        participantNumber: profile.participantNumber,
        className: profile.className,
        schoolName: profile.schoolName,
        questionOrder: orderedIds,
        totalQuestions: orderedIds.length,
        durationMinutes: exam.durationMinutes,
        startedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(safeExpiresMs),
        submittedAt: serverTimestamp(),
        status: AttemptStatus.IN_PROGRESS,
        answeredCount: 0,
        unansweredCount: orderedIds.length,
        flaggedCount: 0,
        publishedFinalScore: 0,
        publishedRawScore: 0,
        publishedMaxScore: 0,
        publishedCorrectCount: 0,
        publishedWrongCount: 0,
        scorePublished: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'attempts', attemptId), newAttemptPayload);
      if (exam.allowRetake) {
        appendStoredRetakeAttemptId(profile.uid, attemptId);
      }
      const createdSnap = await getDoc(doc(db, 'attempts', attemptId));
      const createdAttempt = createdSnap.data() as AttemptRecord;
      setSelectedExamForInstructions(null);
      onStartOrResumeAttempt(exam, createdAttempt);
    } catch (err) {
      console.error(err);
      setActionError(
        'Gagal memulai sesi ujian. Pastikan ujian sedang berstatus Aktif dan koneksi internet stabil.'
      );
    } finally {
      setStartingExam(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* 3-Zone Top Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          SIMULASI TKA SD
        </span>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#daftar-ujian" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Daftar Simulasi
          </a>
          <a href="#riwayat-ujian" className="hover:text-slate-900 whitespace-nowrap shrink-0">
            Riwayat &amp; Nilai
          </a>
          {isAdmin && onOpenAdminDashboard && (
            <button
              type="button"
              onClick={onOpenAdminDashboard}
              className="text-sky-800 font-semibold hover:underline inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Shield className="w-4 h-4" />
              Dashboard Admin
            </button>
          )}
        </nav>

        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4" />
          Keluar
        </button>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-10">
        {/* Identitas Peserta */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Dashboard Peserta Ujian</p>
              <h1 className="text-2xl font-bold text-slate-900 mt-0.5">{profile.fullName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                <span>
                  Nomor Peserta:{' '}
                  <strong className="font-mono-tabular text-slate-900">
                    {profile.participantNumber}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Kelas: <strong className="text-slate-900">{profile.className}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>{profile.schoolName}</span>
              </div>
            </div>

            {isAdmin && onOpenAdminDashboard && (
              <button
                type="button"
                onClick={onOpenAdminDashboard}
                className="md:hidden px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold inline-flex items-center gap-2 self-start whitespace-nowrap shrink-0"
              >
                <Shield className="w-4 h-4" />
                Buka Dashboard Admin
              </button>
            )}
          </div>
        </section>

        {portalBannerError && (
          <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-950 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <span>{portalBannerError}</span>
          </div>
        )}

        {/* Daftar Simulasi Ujian yang Tersedia */}
        <section id="daftar-ujian" className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Daftar Simulasi Ujian</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Pilih simulasi ujian yang telah dibuka oleh pengawas sekolahmu.
            </p>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-sm text-slate-500">
              Memuat daftar simulasi ujian dari server...
            </div>
          ) : exams.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-base font-semibold text-slate-800">
                Belum Ada Jadwal Simulasi Ujian
              </p>
              <p className="text-sm text-slate-600 mt-1">
                Ujian akan tampil di halaman ini setelah diaktifkan oleh pengawas/admin sekolah.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {exams.map((exam) => {
                const st = getExamStudentState(exam);
                return (
                  <div
                    key={exam.id}
                    className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                        <span>Mata Pelajaran: {exam.subject}</span>
                        <span aria-hidden="true">·</span>
                        <span>Sasaran Kelas: {exam.targetClass}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {exam.questionCount} Soal / {exam.durationMinutes} Menit
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{exam.title}</h3>
                      {exam.description && (
                        <p className="text-sm text-slate-600 leading-relaxed">{exam.description}</p>
                      )}
                      <div className="pt-1 flex items-center gap-2 text-xs font-semibold">
                        {st.code === 'AVAILABLE' || st.code === 'IN_PROGRESS' ? (
                          <span className="text-emerald-700 inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Status: {st.label}
                          </span>
                        ) : st.code === 'COMPLETED' ? (
                          <span className="text-slate-700 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            Status: {st.label}
                          </span>
                        ) : (
                          <span className="text-amber-700 inline-flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Status: {st.label}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {st.code === 'IN_PROGRESS' && st.activeAttempt ? (
                        <button
                          type="button"
                          disabled={resumingExamId === exam.id}
                          onClick={() =>
                            resumeAttemptWithSessionRecovery(exam, st.activeAttempt!)
                          }
                          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-60 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                        >
                          <Play className="w-4 h-4" />
                          {resumingExamId === exam.id
                            ? 'Memulihkan Sesi...'
                            : 'Lanjutkan Ujian'}
                        </button>
                      ) : st.canStart ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setReadyConfirmed(false);
                            setSelectedExamForInstructions(exam);
                          }}
                          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                        >
                          <Play className="w-4 h-4" />
                          Mulai Ujian
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-sm font-semibold cursor-not-allowed whitespace-nowrap shrink-0"
                        >
                          {st.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Riwayat Ujian & Nilai yang Sudah Dipublikasikan */}
        <section id="riwayat-ujian" className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Riwayat Ujian &amp; Nilai Terpublikasi
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Nilai akhir akan ditampilkan setelah proses pemeriksaan kunci jawaban selesai dan
              dipublikasikan oleh guru/admin.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            {attempts.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Belum ada riwayat pengerjaan simulasi ujian pada peserta ini.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                    <th className="py-3 px-4 font-semibold">Nama Ujian</th>
                    <th className="py-3 px-4 font-semibold">Mata Pelajaran</th>
                    <th className="py-3 px-4 font-semibold">Waktu Mulai</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Dijawab</th>
                    <th className="py-3 px-4 font-semibold text-right">Nilai Akhir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {attempts.map((att) => {
                    const parentExam = exams.find((e) => e.id === att.examId);
                    const canShowScore =
                      att.scorePublished && (parentExam ? parentExam.publishScore : true);
                    return (
                      <tr key={att.id} className="hover:bg-slate-50/80">
                        <td className="py-3.5 px-4 font-medium text-slate-900">{att.examTitle}</td>
                        <td className="py-3.5 px-4 text-slate-600">{att.subject}</td>
                        <td className="py-3.5 px-4 font-mono-tabular text-slate-600">
                          {att.startedAt?.toDate
                            ? att.startedAt.toDate().toLocaleString('id-ID', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : '-'}
                        </td>
                        <td className="py-3.5 px-4">
                          {att.status === AttemptStatus.IN_PROGRESS ? (
                            <span className="text-amber-700 font-semibold">Sedang Dikerjakan</span>
                          ) : (
                            <span className="text-emerald-700 font-semibold">
                              Selesai Dikumpulkan
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-700">
                          {att.answeredCount} / {att.totalQuestions}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular">
                          {canShowScore ? (
                            <div>
                              <span className="font-bold text-slate-900 text-base">
                                {att.publishedFinalScore.toFixed(2)}
                              </span>
                              <span className="block text-xs text-slate-500">
                                Benar: {att.publishedCorrectCount} · Salah:{' '}
                                {att.publishedWrongCount}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Menunggu Publikasi</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      <AppFooter />

      {/* Halaman Petunjuk Ujian (10 Poin Wajib Sebelum Mulai) */}
      {selectedExamForInstructions && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exam-instructions-title"
        >
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <p className="text-xs font-medium text-slate-500">Persiapan Peserta CBT</p>
                <h2 id="exam-instructions-title" className="text-lg font-bold text-slate-900">
                  Petunjuk Pengerjaan Ujian
                </h2>
              </div>
              <button
                type="button"
                disabled={startingExam}
                onClick={() => setSelectedExamForInstructions(null)}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                aria-label="Batal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-700">
              {/* Ringkasan Identitas & Ujian */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
                <div>
                  <span className="text-slate-500">Nama Peserta:</span>{' '}
                  <strong className="text-slate-900">{profile.fullName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Nomor Peserta:</span>{' '}
                  <strong className="font-mono-tabular text-slate-900">
                    {profile.participantNumber}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Mata Pelajaran:</span>{' '}
                  <strong className="text-slate-900">
                    {selectedExamForInstructions.subject}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Durasi &amp; Jumlah Soal:</span>{' '}
                  <strong className="font-mono-tabular text-slate-900">
                    {selectedExamForInstructions.durationMinutes} Menit ·{' '}
                    {selectedExamForInstructions.questionCount} Soal
                  </strong>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 mb-2.5">
                  Bacalah 10 Petunjuk Berikut Sebelum Memulai:
                </h3>
                <ol className="list-decimal pl-5 space-y-2 leading-relaxed">
                  <li>Periksa identitas peserta pada kotak di atas dan pastikan sudah benar.</li>
                  <li>Baca setiap soal dengan teliti dari awal hingga akhir kalimat.</li>
                  <li>
                    Pilih jawaban sesuai instruksi pada soal (Pilihan Ganda satu jawaban, Pilihan
                    Ganda Kompleks lebih dari satu jawaban, atau Benar/Salah).
                  </li>
                  <li>
                    Periksa gambar, tabel, dan diagram dengan cermat sebelum menjawab (gunakan
                    tombol <strong>Perbesar Gambar</strong> bila diperlukan).
                  </li>
                  <li>
                    Jawaban akan disimpan secara otomatis jika koneksi internet dan penyimpanan
                    tersedia.
                  </li>
                  <li>
                    Siswa dapat berpindah antarsoal maupun menandai soal untuk ditinjau kembali
                    selama waktu ujian masih berlangsung.
                  </li>
                  <li>Perhatikan sisa waktu ujian pada bagian kanan atas layar.</li>
                  <li>Periksa kembali seluruh kelengkapan jawaban sebelum mengakhiri ujian.</li>
                  <li>
                    Setelah dikumpulkan, ujian tidak dapat dilanjutkan kembali apabila pengaturan
                    ujian tidak mengizinkan percobaan ulang.
                  </li>
                  <li>
                    Jangan menutup halaman ujian sebelum indikator penyimpanan menunjukkan jawaban
                    telah tersimpan.
                  </li>
                </ol>
              </div>

              {actionError && (
                <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}

              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-sky-200 bg-sky-50/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={readyConfirmed}
                  onChange={(e) => setReadyConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-sky-700 rounded"
                />
                <span className="text-sm font-medium text-slate-900">
                  Saya telah memeriksa identitas peserta, memahami seluruh petunjuk di atas, dan
                  siap mengikuti simulasi ujian sekarang.
                </span>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={startingExam}
                onClick={() => setSelectedExamForInstructions(null)}
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Kembali
              </button>
              <button
                type="button"
                disabled={!readyConfirmed || startingExam}
                onClick={handleConfirmStartExam}
                className="min-h-[44px] px-6 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-bold hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                {startingExam ? 'Menyiapkan Soal...' : 'MULAI UJIAN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
