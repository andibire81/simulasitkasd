import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Grid,
  Loader2,
  RefreshCw,
  Send,
  WifiOff,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import {
  AttemptRecord,
  AttemptStatus,
  ExamRecord,
  QuestionOption,
  QuestionRecord,
  QuestionType,
  ResponseRecord,
} from '../types/cbt';
import {
  formatRemainingSeconds,
  getAuthoritativeNowMs,
  syncServerClock,
} from '../lib/serverClock';
import { isResponseAnswered } from '../lib/gradingEngine';
import { getTrueFalseLabels } from '../lib/trueFalseLabels';
import { QuestionContentView } from './QuestionContentView';
import { MathText } from './MathText';
import { ZoomableImage } from './ZoomableImage';

interface CbtExamRunnerProps {
  exam: ExamRecord;
  attempt: AttemptRecord;
  onExitCompleted: () => void;
}

type SyncState = 'idle_synced' | 'saving' | 'local_unsynced';

function deterministicOptionOrder(
  options: QuestionOption[],
  seedStr: string
): QuestionOption[] {
  const arr = [...options];
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

export const CbtExamRunner: React.FC<CbtExamRunnerProps> = ({
  exam,
  attempt,
  onExitCompleted,
}) => {
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [responsesMap, setResponsesMap] = useState<Record<string, ResponseRecord>>({});
  const [pendingQuestionIds, setPendingQuestionIds] = useState<string[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle_synced');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    const expMs = attempt.expiresAt?.toMillis?.() || Date.now() + exam.durationMinutes * 60_000;
    return Math.max(0, Math.floor((expMs - getAuthoritativeNowMs()) / 1000));
  });

  const [showNavDrawer, setShowNavDrawer] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitFinishedMessage, setSubmitFinishedMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createdDocsSetRef = useRef<Set<string>>(new Set());
  const seqCounterRef = useRef<Record<string, number>>({});
  const responsesRef = useRef<Record<string, ResponseRecord>>({});
  responsesRef.current = responsesMap;

  const autoSubmitTriggeredRef = useRef(false);
  const localBackupKey = `cbt_backup_${attempt.id}`;

  // Load questions + server responses + merge any newer local unsynced responses
  const initializeExamSession = useCallback(async () => {
    setLoadingQuestions(true);
    setLoadError(null);
    try {
      await syncServerClock();

      // Load verified questions in attempt.questionOrder via deterministic getDoc
      const fetchedQuestions = await Promise.all(
        attempt.questionOrder.map(async (qId) => {
          try {
            const snap = await getDoc(doc(db, 'questions', qId));
            if (!snap.exists()) return null;
            const q = snap.data() as QuestionRecord;
            return q.verificationStatus === 'verified' ? q : null;
          } catch {
            return null;
          }
        })
      );

      const orderedQuestions = fetchedQuestions.filter(
        (q): q is QuestionRecord => Boolean(q)
      );

      if (orderedQuestions.length === 0) {
        setLoadError('Gagal memuat daftar soal terverifikasi untuk sesi ujian ini.');
        setLoadingQuestions(false);
        return;
      }

      setQuestions(orderedQuestions);

      // Fetch existing server responses for this attempt via capability-keyed doc IDs
      const loadedResponses: Record<string, ResponseRecord> = {};
      await Promise.all(
        orderedQuestions.map(async (q) => {
          const respDocId = `${attempt.sessionId}_${q.id}`;
          try {
            const respSnap = await getDoc(
              doc(db, 'attempts', attempt.id, 'responses', respDocId)
            );
            if (respSnap.exists()) {
              const r = respSnap.data() as ResponseRecord;
              loadedResponses[q.id] = r;
              createdDocsSetRef.current.add(respDocId);
              seqCounterRef.current[q.id] = r.clientSequence || 1;
            }
          } catch {
            // Ignore uncreated slot
          }
        })
      );

      // Check local storage backup for any higher clientSequence unsynced items
      const unsyncedIds: string[] = [];
      try {
        const rawLocal = localStorage.getItem(localBackupKey);
        if (rawLocal) {
          const parsedLocal = JSON.parse(rawLocal) as Record<string, ResponseRecord>;
          for (const [qId, localResp] of Object.entries(parsedLocal)) {
            const serverResp = loadedResponses[qId];
            if (!serverResp || (localResp.clientSequence || 0) > (serverResp.clientSequence || 0)) {
              loadedResponses[qId] = {
                ...localResp,
                sessionId: attempt.sessionId,
              };
              seqCounterRef.current[qId] = localResp.clientSequence || 1;
              unsyncedIds.push(qId);
            }
          }
        }
      } catch {
        // Ignore malformed local storage
      }

      setResponsesMap(loadedResponses);
      setPendingQuestionIds(unsyncedIds);
      setSyncState(unsyncedIds.length > 0 ? 'local_unsynced' : 'idle_synced');
    } catch (err) {
      console.error('Failed loading CBT session:', err);
      setLoadError(
        'Gagal memuat soal ujian. Periksa sambungan internet Anda lalu tekan Muat Ulang Soal.'
      );
    } finally {
      setLoadingQuestions(false);
    }
  }, [attempt.id, attempt.questionOrder, attempt.sessionId, localBackupKey]);

  useEffect(() => {
    initializeExamSession();
  }, [initializeExamSession]);

  // Persist responses backup to localStorage
  const persistLocalBackup = useCallback(
    (nextMap: Record<string, ResponseRecord>) => {
      try {
        localStorage.setItem(localBackupKey, JSON.stringify(nextMap));
      } catch {
        // Ignore storage quota warning
      }
    },
    [localBackupKey]
  );

  // Sync single response to Firestore with sequence & create/update awareness
  const pushResponseToServer = useCallback(
    async (resp: ResponseRecord): Promise<boolean> => {
      const respDocId = `${attempt.sessionId}_${resp.questionId}`;
      const docRef = doc(db, 'attempts', attempt.id, 'responses', respDocId);
      try {
        if (createdDocsSetRef.current.has(respDocId)) {
          await updateDoc(docRef, {
            selectedOptionId: resp.selectedOptionId,
            selectedOptionIds: resp.selectedOptionIds,
            statementAnswers: resp.statementAnswers,
            flaggedForReview: resp.flaggedForReview,
            clientSequence: resp.clientSequence,
            updatedAt: serverTimestamp(),
          });
        } else {
          // Check if exists on server first in case of reload race
          const existingSnap = await getDoc(docRef);
          if (existingSnap.exists()) {
            createdDocsSetRef.current.add(respDocId);
            await updateDoc(docRef, {
              selectedOptionId: resp.selectedOptionId,
              selectedOptionIds: resp.selectedOptionIds,
              statementAnswers: resp.statementAnswers,
              flaggedForReview: resp.flaggedForReview,
              clientSequence: resp.clientSequence,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(docRef, {
              attemptId: attempt.id,
              questionId: resp.questionId,
              examId: exam.id,
              studentUid: attempt.studentUid,
              sessionId: attempt.sessionId,
              questionType: resp.questionType,
              selectedOptionId: resp.selectedOptionId,
              selectedOptionIds: resp.selectedOptionIds,
              statementAnswers: resp.statementAnswers,
              flaggedForReview: resp.flaggedForReview,
              clientSequence: resp.clientSequence,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            createdDocsSetRef.current.add(respDocId);
          }
        }
        return true;
      } catch (err) {
        console.warn('Response sync deferred:', err);
        return false;
      }
    },
    [attempt.id, attempt.sessionId, attempt.studentUid, exam.id]
  );

  // Update summary counters on parent attempt
  const syncAttemptCounters = useCallback(
    async (mapSnapshot: Record<string, ResponseRecord>, qList: QuestionRecord[]) => {
      if (qList.length === 0) return;
      let answered = 0;
      let flagged = 0;
      for (const q of qList) {
        const r = mapSnapshot[q.id];
        if (isResponseAnswered(q, r)) answered += 1;
        if (r?.flaggedForReview) flagged += 1;
      }
      const unanswered = Math.max(0, qList.length - answered);
      try {
        await updateDoc(doc(db, 'attempts', attempt.id), {
          answeredCount: answered,
          unansweredCount: unanswered,
          flaggedCount: flagged,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-fatal counter update
      }
    },
    [attempt.id]
  );

  // Flush all pending unsynced responses
  const flushPendingResponses = useCallback(async (): Promise<boolean> => {
    const currentPending = [...pendingQuestionIds];
    if (currentPending.length === 0) {
      setSyncState('idle_synced');
      return true;
    }

    setSyncState('saving');
    const stillFailed: string[] = [];
    for (const qId of currentPending) {
      const latestResp = responsesRef.current[qId];
      if (!latestResp) continue;
      const ok = await pushResponseToServer(latestResp);
      if (!ok) {
        stillFailed.push(qId);
      }
    }

    setPendingQuestionIds(stillFailed);
    if (stillFailed.length === 0) {
      setSyncState('idle_synced');
      await syncAttemptCounters(responsesRef.current, questions);
      return true;
    } else {
      setSyncState('local_unsynced');
      return false;
    }
  }, [pendingQuestionIds, pushResponseToServer, questions, syncAttemptCounters]);

  // Network online/offline listeners & background retry loop
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushPendingResponses();
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const retryInterval = window.setInterval(() => {
      if (navigator.onLine && pendingQuestionIds.length > 0) {
        flushPendingResponses();
      }
    }, 6000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(retryInterval);
    };
  }, [flushPendingResponses, pendingQuestionIds.length]);

  // Submit / Auto-Submit Exam Handler
  const finalizeSubmission = useCallback(
    async (isExpiredAutoSubmit: boolean) => {
      if (submitting) return;
      setSubmitting(true);
      setSubmitError(null);

      try {
        if (!isExpiredAutoSubmit && pendingQuestionIds.length > 0) {
          const allSynced = await flushPendingResponses();
          if (!allSynced) {
            setSubmitError(
              'Masih terdapat jawaban yang belum tersinkronisasi ke server. Periksa koneksi internet lalu tekan Sinkronkan & Kumpulkan.'
            );
            setSubmitting(false);
            return;
          }
        } else if (isExpiredAutoSubmit && pendingQuestionIds.length > 0) {
          // Best-effort flush before deadline lock
          await flushPendingResponses();
        }

        let answered = 0;
        let flagged = 0;
        for (const q of questions) {
          const r = responsesRef.current[q.id];
          if (isResponseAnswered(q, r)) answered += 1;
          if (r?.flaggedForReview) flagged += 1;
        }
        const unanswered = Math.max(0, questions.length - answered);

        await updateDoc(doc(db, 'attempts', attempt.id), {
          status: isExpiredAutoSubmit
            ? AttemptStatus.EXPIRED_SUBMITTED
            : AttemptStatus.SUBMITTED,
          submittedAt: serverTimestamp(),
          answeredCount: answered,
          unansweredCount: unanswered,
          flaggedCount: flagged,
          updatedAt: serverTimestamp(),
        });

        try {
          localStorage.removeItem(localBackupKey);
        } catch {
          // ignore
        }

        setShowSubmitModal(false);
        setSubmitFinishedMessage(
          isExpiredAutoSubmit
            ? 'Waktu ujian telah habis. Jawaban yang telah tersimpan berhasil dikumpulkan secara otomatis.'
            : 'Ujian Anda telah berhasil dikumpulkan dan tercatat di server.'
        );
      } catch (err) {
        console.error('Error submitting attempt:', err);
        setSubmitError(
          'Gagal mengumpulkan ujian ke server. Pastikan koneksi internet aktif lalu coba kembali.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [attempt.id, flushPendingResponses, localBackupKey, pendingQuestionIds.length, questions, submitting]
  );

  // Server-controlled countdown timer
  useEffect(() => {
    const expMs = attempt.expiresAt?.toMillis?.() || Date.now() + exam.durationMinutes * 60_000;

    // Periodic server clock re-verification every 45 seconds
    const clockResyncId = window.setInterval(() => {
      syncServerClock();
    }, 45_000);

    const tickId = window.setInterval(() => {
      const rem = Math.max(0, Math.floor((expMs - getAuthoritativeNowMs()) / 1000));
      setRemainingSeconds(rem);
      if (rem <= 0 && !autoSubmitTriggeredRef.current && !submitFinishedMessage) {
        autoSubmitTriggeredRef.current = true;
        finalizeSubmission(true);
      }
    }, 1000);

    return () => {
      window.clearInterval(clockResyncId);
      window.clearInterval(tickId);
    };
  }, [attempt.expiresAt, exam.durationMinutes, finalizeSubmission, submitFinishedMessage]);

  // Update response helper for current question
  const mutateCurrentResponse = async (
    question: QuestionRecord,
    updater: (prev: ResponseRecord) => ResponseRecord
  ) => {
    if (remainingSeconds <= 0 || submitFinishedMessage) return;

    const prevResp: ResponseRecord = responsesRef.current[question.id] || {
      attemptId: attempt.id,
      questionId: question.id,
      examId: exam.id,
      studentUid: attempt.studentUid,
      sessionId: attempt.sessionId,
      questionType: question.questionType,
      selectedOptionId: '',
      selectedOptionIds: [],
      statementAnswers: {},
      flaggedForReview: false,
      clientSequence: 0,
    };

    const nextSeq = (seqCounterRef.current[question.id] || prevResp.clientSequence || 0) + 1;
    seqCounterRef.current[question.id] = nextSeq;

    const updatedResp: ResponseRecord = {
      ...updater(prevResp),
      sessionId: attempt.sessionId,
      clientSequence: nextSeq,
    };

    const nextMap = {
      ...responsesRef.current,
      [question.id]: updatedResp,
    };

    setResponsesMap(nextMap);
    persistLocalBackup(nextMap);
    setSyncState('saving');

    const ok = await pushResponseToServer(updatedResp);
    if (ok) {
      // Only mark synced if no newer sequence superseded this call
      if (seqCounterRef.current[question.id] === nextSeq) {
        setPendingQuestionIds((prev) => {
          const filtered = prev.filter((id) => id !== question.id);
          setSyncState(filtered.length > 0 ? 'local_unsynced' : 'idle_synced');
          return filtered;
        });
        syncAttemptCounters(nextMap, questions);
      }
    } else {
      setPendingQuestionIds((prev) =>
        prev.includes(question.id) ? prev : [...prev, question.id]
      );
      setSyncState('local_unsynced');
    }
  };

  // Summary metrics
  const summaryStats = useMemo(() => {
    let answeredCount = 0;
    const unansweredNumbers: number[] = [];
    const flaggedNumbers: number[] = [];

    questions.forEach((q, idx) => {
      const r = responsesMap[q.id];
      const answered = isResponseAnswered(q, r);
      if (answered) answeredCount += 1;
      else unansweredNumbers.push(idx + 1);
      if (r?.flaggedForReview) flaggedNumbers.push(idx + 1);
    });

    return {
      answeredCount,
      unansweredCount: Math.max(0, questions.length - answeredCount),
      unansweredNumbers,
      flaggedNumbers,
    };
  }, [questions, responsesMap]);

  // Completed Screen
  if (submitFinishedMessage) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 p-8 text-center space-y-5">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Ujian Selesai Dikumpulkan</h1>
          <p className="text-sm text-slate-600 leading-relaxed">{submitFinishedMessage}</p>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 flex items-center justify-around font-mono-tabular">
            <div>
              <span className="block text-xs text-slate-500">Soal Dijawab</span>
              <strong className="text-lg text-slate-900">{summaryStats.answeredCount}</strong>
            </div>
            <div className="h-8 border-l border-slate-200" />
            <div>
              <span className="block text-xs text-slate-500">Belum Dijawab</span>
              <strong className="text-lg text-slate-900">{summaryStats.unansweredCount}</strong>
            </div>
          </div>
          <button
            type="button"
            onClick={onExitCompleted}
            className="w-full min-h-[46px] px-6 py-3 rounded-lg bg-sky-700 text-white text-base font-semibold hover:bg-sky-800 transition-colors"
          >
            Kembali ke Dashboard Siswa
          </button>
        </div>
      </div>
    );
  }

  if (loadingQuestions) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3 max-w-md w-full">
          <Loader2 className="w-8 h-8 text-sky-700 animate-spin mx-auto" />
          <p className="text-base font-semibold text-slate-900">Memuat Lembar Soal CBT...</p>
          <p className="text-xs text-slate-500">
            Menyinkronkan waktu server dan jawaban tersimpan Anda.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || questions.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center space-y-4 max-w-md w-full">
          <AlertTriangle className="w-10 h-10 text-red-600 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Soal Belum Dapat Dimuat</h1>
          <p className="text-sm text-slate-600">{loadError}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={initializeExamSession}
              className="px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Muat Ulang Soal
            </button>
            <button
              type="button"
              onClick={onExitCompleted}
              className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Kembali
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const currentResponse = responsesMap[currentQuestion.id];
  const displayedOptions =
    exam.shuffleOptions && !currentQuestion.lockOptionOrder
      ? deterministicOptionOrder(
          currentQuestion.options,
          `${attempt.id}_${currentQuestion.id}_opts`
        )
      : currentQuestion.options;

  const isLowTime = remainingSeconds <= 300; // <= 5 minutes warning

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* Sticky CBT Header (Compact <= 10% mobile viewport height) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 md:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Exam & Student Info */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 truncate">
              <span className="truncate">{exam.title}</span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span className="text-sky-800 shrink-0">{exam.subject}</span>
            </div>
            <div className="text-xs text-slate-600 truncate">
              <span>{attempt.studentName}</span>
              <span aria-hidden="true" className="mx-1.5">
                ·
              </span>
              <span className="font-mono-tabular">No. {attempt.participantNumber}</span>
            </div>
          </div>

          {/* Right: Save Status + Server Countdown Timer + Nav Drawer Button */}
          <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
            {/* Save Status Indicator */}
            <div className="text-xs font-medium">
              {syncState === 'saving' ? (
                <span className="inline-flex items-center gap-1.5 text-sky-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Menyimpan...</span>
                </span>
              ) : syncState === 'local_unsynced' || !isOnline ? (
                <button
                  type="button"
                  onClick={() => flushPendingResponses()}
                  className="inline-flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-md hover:bg-amber-100"
                  title="Klik untuk menyinkronkan ulang ke server"
                >
                  <WifiOff className="w-3.5 h-3.5 text-amber-700" />
                  <span>
                    {isOnline
                      ? `Belum Sinkron (${pendingQuestionIds.length})`
                      : 'Luring — Tersimpan Lokal'}
                  </span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tersimpan di Server</span>
                  <span className="sm:hidden">Tersimpan</span>
                </span>
              )}
            </div>

            {/* Countdown Timer */}
            <div
              className={`px-3 py-1.5 rounded-lg border font-mono-tabular text-sm font-bold inline-flex items-center gap-1.5 ${
                isLowTime
                  ? 'bg-red-50 border-red-300 text-red-800'
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
              aria-live="polite"
            >
              <Clock className={`w-4 h-4 ${isLowTime ? 'text-red-700' : 'text-slate-600'}`} />
              <span>{formatRemainingSeconds(remainingSeconds)}</span>
            </div>

            {/* Mobile/Tablet Question List Button */}
            <button
              type="button"
              onClick={() => setShowNavDrawer(true)}
              className="lg:hidden px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Grid className="w-4 h-4" />
              <span>Daftar Soal</span>
            </button>
          </div>
        </div>
      </header>

      {/* Low Time Warning Banner */}
      {isLowTime && remainingSeconds > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-xs font-semibold text-red-800">
          Perhatian: Waktu pengerjaan tersisa kurang dari 5 menit. Periksa kembali jawaban Anda.
        </div>
      )}

      {/* Offline / Unsynced Warning Banner */}
      {(!isOnline || syncState === 'local_unsynced') && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-center gap-3">
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            {!isOnline
              ? 'Koneksi internet sedang terputus. Jawaban Anda diamankan di perangkat dan akan dikirim otomatis saat internet tersambung.'
              : `${pendingQuestionIds.length} jawaban belum terkirim ke server.`}
          </span>
          {isOnline && (
            <button
              type="button"
              onClick={() => flushPendingResponses()}
              className="px-2.5 py-1 rounded bg-amber-800 text-white font-semibold hover:bg-amber-900 whitespace-nowrap shrink-0"
            >
              Sinkronkan Sekarang
            </button>
          )}
        </div>
      )}

      {/* Main Two-Column CBT Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center: Question Stage (8 cols on desktop) */}
        <section className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 md:p-8 space-y-6">
          {/* Question Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-slate-900 font-mono-tabular">
                Soal Nomor {currentIndex + 1}
              </span>
              <span className="text-xs text-slate-500">
                dari {questions.length} soal
              </span>
            </div>

            <div className="text-xs font-medium text-slate-600">
              {currentQuestion.questionType === QuestionType.SINGLE_CHOICE &&
                'Pilihan Ganda (Satu Jawaban)'}
              {currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX &&
                'Pilihan Ganda Kompleks (Lebih dari Satu Jawaban)'}
              {currentQuestion.questionType === QuestionType.TRUE_FALSE &&
                'Pernyataan Benar / Salah'}
            </div>
          </div>

          {/* Stem + Original PDF Graphics */}
          <QuestionContentView question={currentQuestion} />

          {/* Answer Input Area */}
          <div className="pt-2 space-y-3">
            {currentQuestion.questionType === QuestionType.UNSUPPORTED && (
              <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
                Jenis soal ini belum didukung secara interaktif. Hubungi pengawas ujian.
              </div>
            )}

            {/* 1. Single Choice */}
            {currentQuestion.questionType === QuestionType.SINGLE_CHOICE && (
              <div className="space-y-3" role="radiogroup" aria-label="Pilihan Jawaban">
                {displayedOptions.map((opt) => {
                  const selected = currentResponse?.selectedOptionId === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() =>
                        mutateCurrentResponse(currentQuestion, (prev) => ({
                          ...prev,
                          selectedOptionId: opt.id,
                        }))
                      }
                      role="radio"
                      aria-checked={selected}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          mutateCurrentResponse(currentQuestion, (prev) => ({
                            ...prev,
                            selectedOptionId: opt.id,
                          }));
                        }
                      }}
                      className={`min-h-[52px] p-4 rounded-xl border cursor-pointer transition-colors flex items-start gap-3.5 focus-visible:outline-2 focus-visible:outline-sky-700 ${
                        selected
                          ? 'border-sky-700 bg-sky-50/70'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 mt-0.5 border ${
                          selected
                            ? 'bg-sky-700 border-sky-700 text-white'
                            : 'bg-slate-50 border-slate-300 text-slate-800'
                        }`}
                      >
                        {opt.label}
                      </span>
                      <div className="flex-1 min-w-0 pt-1">
                        {opt.text && (
                          <div className="text-[16px] text-slate-900 leading-relaxed">
                            <MathText text={opt.text} />
                          </div>
                        )}
                        {opt.imageUrl && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <ZoomableImage
                              src={opt.imageUrl}
                              alt={`Pilihan ${opt.label} Soal Nomor ${currentQuestion.originalNumber}`}
                              maxHeightClass="max-h-[300px]"
                            />
                          </div>
                        )}
                      </div>
                      {selected && (
                        <span className="text-xs font-semibold text-sky-800 shrink-0 self-center inline-flex items-center gap-1">
                          <Check className="w-4 h-4" />
                          Dipilih
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. Multiple Choice Complex (Checkboxes) */}
            {currentQuestion.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-sky-800">
                  Petunjuk: Centang seluruh kotak pernyataan yang benar (dapat memilih lebih dari
                  satu jawaban).
                </p>
                {displayedOptions.map((opt) => {
                  const currentList = currentResponse?.selectedOptionIds || [];
                  const checked = currentList.includes(opt.id);
                  const toggleOption = () => {
                    mutateCurrentResponse(currentQuestion, (prev) => {
                      const list = prev.selectedOptionIds || [];
                      const nextList = list.includes(opt.id)
                        ? list.filter((x) => x !== opt.id)
                        : [...list, opt.id].sort();
                      return {
                        ...prev,
                        selectedOptionIds: nextList,
                      };
                    });
                  };

                  return (
                    <div
                      key={opt.id}
                      onClick={toggleOption}
                      role="checkbox"
                      aria-checked={checked}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleOption();
                        }
                      }}
                      className={`min-h-[52px] p-4 rounded-xl border cursor-pointer transition-colors flex items-start gap-3.5 focus-visible:outline-2 focus-visible:outline-sky-700 ${
                        checked
                          ? 'border-sky-700 bg-sky-50/70'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded border flex items-center justify-center shrink-0 mt-1 ${
                          checked
                            ? 'bg-sky-700 border-sky-700 text-white'
                            : 'bg-white border-slate-400 text-transparent'
                        }`}
                      >
                        <Check className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <span className="font-bold text-slate-800 mr-2">{opt.label}.</span>
                        {opt.text && (
                          <span className="text-[16px] text-slate-900 leading-relaxed">
                            <MathText text={opt.text} />
                          </span>
                        )}
                        {opt.imageUrl && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <ZoomableImage
                              src={opt.imageUrl}
                              alt={`Pernyataan ${opt.label} Soal Nomor ${currentQuestion.originalNumber}`}
                              maxHeightClass="max-h-[260px]"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. True / False (or Sesuai/Tidak Sesuai, Setuju/Tidak Setuju) per Statement */}
            {currentQuestion.questionType === QuestionType.TRUE_FALSE && (() => {
              const tfLabels = getTrueFalseLabels(currentQuestion);
              return (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="hidden sm:grid sm:grid-cols-12 bg-slate-50 border-b border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700">
                    <div className="col-span-8">Pernyataan</div>
                    <div className="col-span-4 text-center">{tfLabels.columnTitle}</div>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {currentQuestion.statements.map((stmt) => {
                      const chosenVal = currentResponse?.statementAnswers?.[stmt.id];
                      const setStatementChoice = (val: 'true' | 'false') => {
                        mutateCurrentResponse(currentQuestion, (prev) => ({
                          ...prev,
                          statementAnswers: {
                            ...(prev.statementAnswers || {}),
                            [stmt.id]: val,
                          },
                        }));
                      };

                      return (
                        <div
                          key={stmt.id}
                          className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center"
                        >
                          <div className="sm:col-span-8 space-y-2">
                            <div className="text-[16px] text-slate-900 leading-relaxed">
                              <strong className="mr-2">{stmt.label}.</strong>
                              <MathText text={stmt.text} />
                            </div>
                            {stmt.imageUrl && (
                              <ZoomableImage
                                src={stmt.imageUrl}
                                alt={`Pernyataan ${stmt.label} Soal Nomor ${currentQuestion.originalNumber}`}
                                maxHeightClass="max-h-[200px]"
                              />
                            )}
                          </div>
                          <div className="sm:col-span-4 flex items-center sm:justify-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => setStatementChoice('true')}
                              className={`flex-1 sm:flex-initial min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                chosenVal === 'true'
                                  ? 'bg-sky-700 border-sky-700 text-white'
                                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              {chosenVal === 'true'
                                ? `✓ ${tfLabels.trueLabel}`
                                : tfLabels.trueLabel}
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatementChoice('false')}
                              className={`flex-1 sm:flex-initial min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                chosenVal === 'false'
                                  ? 'bg-slate-900 border-slate-900 text-white'
                                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              {chosenVal === 'false'
                                ? `✓ ${tfLabels.falseLabel}`
                                : tfLabels.falseLabel}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bottom Question Navigation Controls */}
          <div className="pt-6 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              className="min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
              Soal Sebelumnya
            </button>

            <button
              type="button"
              onClick={() =>
                mutateCurrentResponse(currentQuestion, (prev) => ({
                  ...prev,
                  flaggedForReview: !prev.flaggedForReview,
                }))
              }
              className={`min-h-[44px] px-4 py-2.5 rounded-lg border text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
                currentResponse?.flaggedForReview
                  ? 'border-amber-400 bg-amber-100 text-amber-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Flag className="w-4 h-4" />
              {currentResponse?.flaggedForReview
                ? 'Ditandai untuk Ditinjau'
                : 'Tandai untuk Ditinjau'}
            </button>

            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                Soal Berikutnya
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSubmitError(null);
                  setShowSubmitModal(true);
                }}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4" />
                KUMPULKAN UJIAN
              </button>
            )}
          </div>
        </section>

        {/* Right Column: Question Number Navigation Panel (Desktop) */}
        <aside className="hidden lg:block lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Daftar Nomor Soal</h2>
            <span className="text-xs font-mono-tabular text-slate-600">
              {summaryStats.answeredCount}/{questions.length} Dijawab
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {questions.map((q, idx) => {
              const r = responsesMap[q.id];
              const isCurrent = idx === currentIndex;
              const answered = isResponseAnswered(q, r);
              const flagged = Boolean(r?.flaggedForReview);

              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  aria-label={`Nomor ${idx + 1}: ${
                    isCurrent ? 'Sedang dibuka, ' : ''
                  }${flagged ? 'Ditandai untuk ditinjau, ' : ''}${
                    answered ? 'Sudah dijawab' : 'Belum dijawab'
                  }`}
                  className={`min-h-[44px] rounded-lg border text-xs font-mono-tabular font-bold flex flex-col items-center justify-center relative transition-colors ${
                    isCurrent
                      ? 'ring-2 ring-slate-900 border-slate-900 bg-slate-900 text-white'
                      : flagged
                      ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : answered
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{idx + 1}</span>
                  <span className="text-[10px] leading-none mt-0.5">
                    {flagged ? '⚑' : answered ? '✓' : '○'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Non-Hue-Only Legend */}
          <div className="pt-3 border-t border-slate-200 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-slate-900 text-white font-mono-tabular text-[10px] flex items-center justify-center font-bold">
                1
              </span>
              <span>Sedang Dibuka</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded border border-emerald-600 bg-emerald-50 text-emerald-900 text-[10px] flex items-center justify-center font-bold">
                ✓
              </span>
              <span>Sudah Dijawab</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded border border-amber-400 bg-amber-50 text-amber-900 text-[10px] flex items-center justify-center font-bold">
                ⚑
              </span>
              <span>Ditandai Tinjau</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded border border-slate-300 bg-white text-slate-700 text-[10px] flex items-center justify-center font-bold">
                ○
              </span>
              <span>Belum Dijawab</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSubmitError(null);
              setShowSubmitModal(true);
            }}
            className="w-full min-h-[46px] px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            KUMPULKAN UJIAN
          </button>
        </aside>
      </main>

      {/* Mobile/Tablet Question Navigation Modal */}
      {showNavDrawer && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-4 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Daftar Nomor Soal"
          onClick={() => setShowNavDrawer(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-900">Daftar Nomor Soal</h2>
              <button
                type="button"
                onClick={() => setShowNavDrawer(false)}
                className="p-1.5 rounded border border-slate-200 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const r = responsesMap[q.id];
                const isCurrent = idx === currentIndex;
                const answered = isResponseAnswered(q, r);
                const flagged = Boolean(r?.flaggedForReview);

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowNavDrawer(false);
                    }}
                    className={`min-h-[44px] rounded-lg border text-xs font-mono-tabular font-bold flex flex-col items-center justify-center ${
                      isCurrent
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : flagged
                        ? 'border-amber-400 bg-amber-50 text-amber-900'
                        : answered
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <span>{idx + 1}</span>
                    <span className="text-[10px] leading-none mt-0.5">
                      {flagged ? '⚑' : answered ? '✓' : '○'}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowNavDrawer(false);
                setSubmitError(null);
                setShowSubmitModal(true);
              }}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              KUMPULKAN UJIAN
            </button>
          </div>
        </div>
      )}

      {/* Confirmation & Submission Modal */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
        >
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 id="submit-confirm-title" className="text-lg font-bold text-slate-900">
                Konfirmasi Pengumpulan Ujian
              </h2>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitModal(false)}
                className="p-1.5 rounded border border-slate-200 bg-white text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm text-slate-700">
              <p>Periksa ringkasan pengerjaan soal Anda sebelum mengakhiri ujian:</p>

              <div className="grid grid-cols-3 gap-3 text-center font-mono-tabular">
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="block text-xs text-slate-500 font-sans">Sudah Dijawab</span>
                  <strong className="text-xl text-emerald-700">{summaryStats.answeredCount}</strong>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="block text-xs text-slate-500 font-sans">Belum Dijawab</span>
                  <strong className="text-xl text-slate-900">{summaryStats.unansweredCount}</strong>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="block text-xs text-slate-500 font-sans">Ditandai Tinjau</span>
                  <strong className="text-xl text-amber-700">
                    {summaryStats.flaggedNumbers.length}
                  </strong>
                </div>
              </div>

              {summaryStats.unansweredNumbers.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                  <strong>Nomor soal belum dijawab:</strong>{' '}
                  {summaryStats.unansweredNumbers.join(', ')}
                </div>
              )}

              {summaryStats.flaggedNumbers.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                  <strong>Nomor soal ditandai untuk ditinjau:</strong>{' '}
                  {summaryStats.flaggedNumbers.join(', ')}
                </div>
              )}

              {pendingQuestionIds.length > 0 && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-900 flex items-center justify-between gap-2">
                  <span>
                    Terdapat {pendingQuestionIds.length} jawaban yang belum tersinkronisasi ke
                    server.
                  </span>
                  <button
                    type="button"
                    onClick={() => flushPendingResponses()}
                    className="px-2.5 py-1 rounded bg-red-800 text-white font-semibold whitespace-nowrap shrink-0"
                  >
                    Sinkronkan Ulang
                  </button>
                </div>
              )}

              {submitError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
                  {submitError}
                </div>
              )}

              <p className="text-xs text-slate-500">
                Setelah tombol <strong>Ya, Kumpulkan Ujian</strong> ditekan, status ujian akan
                menjadi SELESAI dan jawaban tidak dapat diubah kembali.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => finalizeSubmission(false)}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan Ujian'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
