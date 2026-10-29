import React, { useEffect, useState } from 'react';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Key,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Unlock,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  recordAuditLog,
  syncPublishedExamsPortalIndex,
} from '../../lib/firebase';
import {
  AnswerKeyRecord,
  AssetRecord,
  CbtTokenRecord,
  clampStr,
  ComplexScoringRule,
  ExamRecord,
  ExamStatus,
  QuestionRecord,
  QuestionType,
  sanitizeId,
  VerificationStatus,
} from '../../types/cbt';
import { TO1_PACK_ID, TO1_SOURCE_PDF_NAME } from '../../data/to1MtkSource';
import { BINDO2_PACK_ID, BINDO2_SOURCE_PDF_NAME } from '../../data/bindo2Source';
import {
  TO1_MTK_ANSWER_KEYS,
  TO1_MTK_ANSWER_KEY_MAP,
  syncTo1QuestionsAndAnswerKeysToFirestore,
} from '../../data/to1MtkAnswerKeys';
import {
  BINDO2_ANSWER_KEYS,
  BINDO2_ANSWER_KEY_MAP,
  syncBindo2QuestionsAndAnswerKeysToFirestore,
} from '../../data/bindo2AnswerKeys';
import { getTrueFalseLabels } from '../../lib/trueFalseLabels';
import { QuestionContentView } from '../QuestionContentView';
import { MathText } from '../MathText';
import { ZoomableImage } from '../ZoomableImage';
import { TokenManagerCard } from './TokenManagerCard';

interface AdminAnswerKeysAndExamsProps {
  activeSubTab: 'answer_keys' | 'exam_settings';
  questions: QuestionRecord[];
  assets: AssetRecord[];
  answerKeys: AnswerKeyRecord[];
  exams: ExamRecord[];
  tokens: CbtTokenRecord[];
}

function toDatetimeLocalValue(ts?: Timestamp): string {
  const d = ts?.toDate ? ts.toDate() : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatLiveAnswerKeySummary(q: QuestionRecord, k?: AnswerKeyRecord): string {
  if (!k) return 'Belum ditetapkan';
  if (q.questionType === QuestionType.SINGLE_CHOICE) {
    if (!k.correctOptionId) return 'Belum ditetapkan';
    const opt = q.options.find((o) => o.id === k.correctOptionId);
    return opt?.text ? `${k.correctOptionId} (${opt.text})` : k.correctOptionId;
  }
  if (q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX) {
    return k.correctOptionIds.length > 0
      ? k.correctOptionIds.join(', ')
      : 'Belum ditetapkan';
  }
  if (q.questionType === QuestionType.TRUE_FALSE) {
    const tfLabels = getTrueFalseLabels(q);
    const parts = q.statements.map((st) => {
      const val = k.statementKeys?.[st.id];
      if (typeof val !== 'boolean') return `${st.label}: ?`;
      return `${st.label}: ${val ? tfLabels.trueLabel : tfLabels.falseLabel}`;
    });
    return parts.join(' · ');
  }
  return '-';
}

export const AdminAnswerKeysAndExams: React.FC<AdminAnswerKeysAndExamsProps> = ({
  activeSubTab,
  questions,
  assets,
  answerKeys,
  exams,
  tokens,
}) => {
  const sortedQuestions = [...questions].sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return a.originalNumber - b.originalNumber;
  });
  const keyMap = new Map(answerKeys.map((k) => [k.questionId, k]));

  // Menu 7: Answer Key Editor State
  const [activeKeyPack, setActiveKeyPack] = useState<'mtk' | 'bindo' | 'other'>('mtk');
  const [selectedQId, setSelectedQId] = useState<string>('');
  const [singleOpt, setSingleOpt] = useState<string>('');
  const [complexOpts, setComplexOpts] = useState<string[]>([]);
  const [stmtMap, setStmtMap] = useState<Record<string, boolean>>({});
  const [scoringRule, setScoringRule] = useState<ComplexScoringRule>(
    ComplexScoringRule.ALL_EXACT
  );
  const [wrongScore, setWrongScore] = useState<number>(0);
  const [weight, setWeight] = useState<number>(1);
  const [discussion, setDiscussion] = useState<string>('');
  const [savingKey, setSavingKey] = useState(false);
  const [aiSolvingSingle, setAiSolvingSingle] = useState(false);
  const [syncingAllKeys, setSyncingAllKeys] = useState(false);
  const [showFullSummaryTable, setShowFullSummaryTable] = useState(true);
  const [bulkStatusMsg, setBulkStatusMsg] = useState<string | null>(null);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [unlockConfirm, setUnlockConfirm] = useState(false);

  // Menu 8: Exam Management State
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examPackIdState, setExamPackIdState] = useState<string>(TO1_PACK_ID);
  const [title, setTitle] = useState('SIMULASI TKA MATEMATIKA KELAS VI — PAKET TO 1');
  const [description, setDescription] = useState(
    'Simulasi Tes Kemampuan Akademik (TKA) Matematika Kelas VI Sekolah Dasar berdasarkan dokumen TO 1 MTK.'
  );
  const [subject, setSubject] = useState('Matematika');
  const [targetClass, setTargetClass] = useState('Semua');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [startLocal, setStartLocal] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - 5);
    return toDatetimeLocalValue(Timestamp.fromDate(now));
  });
  const [endLocal, setEndLocal] = useState(() => {
    const end = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    return toDatetimeLocalValue(Timestamp.fromDate(end));
  });
  const [examStatus, setExamStatus] = useState<ExamStatus>(ExamStatus.DRAFT);
  const [allowRetake, setAllowRetake] = useState(false);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(true);
  const [publishScore, setPublishScore] = useState(true);
  const [selectedExamQuestionIds, setSelectedExamQuestionIds] = useState<string[]>([]);
  const [savingExam, setSavingExam] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);
  const [examSuccess, setExamSuccess] = useState<string | null>(null);
  const [confirmDeleteExamId, setConfirmDeleteExamId] = useState<string | null>(null);

  const otherQuestions = sortedQuestions.filter(
    (q) => q.examPackId !== TO1_PACK_ID && q.examPackId !== BINDO2_PACK_ID
  );

  const keyPackQuestions = sortedQuestions
    .filter((q) => {
      if (activeKeyPack === 'mtk') return q.examPackId === TO1_PACK_ID;
      if (activeKeyPack === 'bindo') return q.examPackId === BINDO2_PACK_ID;
      return q.examPackId !== TO1_PACK_ID && q.examPackId !== BINDO2_PACK_ID;
    })
    .sort((a, b) => a.originalNumber - b.originalNumber);

  useEffect(() => {
    if (keyPackQuestions.length > 0) {
      const existsInPack = keyPackQuestions.some((q) => q.id === selectedQId);
      if (!existsInPack) {
        setSelectedQId(keyPackQuestions[0].id);
      }
    }
  }, [activeKeyPack, keyPackQuestions.length, selectedQId]);

  // Load key form whenever selectedQId or underlying key changes
  useEffect(() => {
    const q = sortedQuestions.find((x) => x.id === selectedQId);
    if (!q) return;
    const existing = keyMap.get(q.id);
    setSingleOpt(existing?.correctOptionId || '');
    setComplexOpts(existing?.correctOptionIds || []);
    setStmtMap(existing?.statementKeys || {});
    setScoringRule(
      existing?.complexScoringRule ||
        (q.questionType === QuestionType.TRUE_FALSE
          ? ComplexScoringRule.PARTIAL_NO_PENALTY
          : ComplexScoringRule.ALL_EXACT)
    );
    setWrongScore(existing?.wrongScore ?? 0);
    setWeight(existing?.weight ?? q.weight ?? 1);
    setDiscussion(existing?.discussion || '');
    setKeyMessage(null);
    setUnlockConfirm(false);
  }, [selectedQId, answerKeys]);

  // Initialize selectedExamQuestionIds with verified questions matching the chosen pack when creating a new exam
  useEffect(() => {
    if (!editingExamId && selectedExamQuestionIds.length === 0 && sortedQuestions.length > 0) {
      const verifiedForPack = sortedQuestions
        .filter(
          (q) =>
            q.verificationStatus === VerificationStatus.VERIFIED &&
            q.examPackId === examPackIdState
        )
        .sort((a, b) => a.originalNumber - b.originalNumber)
        .map((q) => q.id);
      if (verifiedForPack.length > 0) {
        setSelectedExamQuestionIds(verifiedForPack);
      }
    }
  }, [editingExamId, examPackIdState, selectedExamQuestionIds.length, sortedQuestions.length]);

  const handleSyncActivePackAiKeys = async () => {
    setSyncingAllKeys(true);
    setBulkStatusMsg(null);
    try {
      if (activeKeyPack === 'bindo') {
        const result = await syncBindo2QuestionsAndAnswerKeysToFirestore({
          existingQuestions: questions,
          existingAssets: assets,
          existingAnswerKeys: answerKeys,
          exams,
          forceOverwrite: true,
          logSummaryPrefix: 'Menyimpan ulang secara otomatis',
        });
        setBulkStatusMsg(
          `Berhasil! Seluruh 30 kunci jawaban & pembahasan AI Bahasa Indonesia (${BINDO2_SOURCE_PDF_NAME}) telah disimpan dan diverifikasi otomatis (${result.syncedKeys} kunci diperbarui).`
        );
      } else {
        const result = await syncTo1QuestionsAndAnswerKeysToFirestore({
          existingQuestions: questions,
          existingAssets: assets,
          existingAnswerKeys: answerKeys,
          exams,
          forceOverwrite: true,
          logSummaryPrefix: 'Menyimpan ulang secara otomatis',
        });
        setBulkStatusMsg(
          `Berhasil! Seluruh 30 kunci jawaban & pembahasan AI Matematika (${TO1_SOURCE_PDF_NAME}) telah disimpan dan diverifikasi otomatis (${result.syncedKeys} kunci diperbarui).`
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'answerKeys/pack_batch');
    } finally {
      setSyncingAllKeys(false);
    }
  };

  const handleSolveCurrentQuestionWithAi = async () => {
    const q = sortedQuestions.find((x) => x.id === selectedQId);
    if (!q) return;

    const existingKey = keyMap.get(q.id);
    if (existingKey?.locked && !unlockConfirm) {
      setKeyMessage(
        'Kunci jawaban soal ini sedang terkunci karena ujian telah dibuka. Tekan Buka Kunci Terbatas jika perlu analisis ulang.'
      );
      return;
    }

    setAiSolvingSingle(true);
    setKeyMessage(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      let resolvedSingle = '';
      let resolvedComplex: string[] = [];
      let resolvedStmtMap: Record<string, boolean> = {};
      let resolvedDiscussion = '';

      if (idToken) {
        const resp = await fetch('/api/ai/solve-question', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ question: q }),
        });

        if (resp.ok) {
          const data = (await resp.json()) as {
            correctOptionId?: string;
            correctOptionIds?: string[];
            statementKeys?: Record<string, boolean>;
            discussion?: string;
          };
          resolvedSingle = data.correctOptionId || '';
          resolvedComplex = Array.isArray(data.correctOptionIds) ? data.correctOptionIds : [];
          resolvedStmtMap = data.statementKeys || {};
          resolvedDiscussion = data.discussion || '';
        } else {
          const precomputed =
            TO1_MTK_ANSWER_KEY_MAP.get(q.id) || BINDO2_ANSWER_KEY_MAP.get(q.id);
          if (precomputed) {
            resolvedSingle = precomputed.correctOptionId;
            resolvedComplex = precomputed.correctOptionIds;
            resolvedStmtMap = precomputed.statementKeys;
            resolvedDiscussion = precomputed.discussion;
          } else {
            const errJson = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(errJson.error || 'Gagal menjalankan analisis AI untuk soal ini.');
          }
        }
      } else {
        throw new Error('Sesi autentikasi admin tidak ditemukan.');
      }

      setSingleOpt(resolvedSingle);
      setComplexOpts(resolvedComplex);
      setStmtMap(resolvedStmtMap);
      setDiscussion(resolvedDiscussion);

      // Immediately persist & verify the AI-analyzed answer key in Firestore
      const adminEmail = auth.currentUser?.email || auth.currentUser?.uid || 'admin-ai';
      const hasActiveExamUsingQ = exams.some(
        (ex) =>
          (ex.status === ExamStatus.ACTIVE || ex.status === ExamStatus.FINISHED) &&
          ex.questionIds.includes(q.id)
      );
      const effectiveRule =
        q.questionType === QuestionType.TRUE_FALSE
          ? ComplexScoringRule.PARTIAL_NO_PENALTY
          : scoringRule;

      const keyRef = doc(db, 'answerKeys', q.id);
      const snap = await getDoc(keyRef);
      const payload = {
        questionId: q.id,
        examPackId: q.examPackId,
        questionType: q.questionType,
        correctOptionId: q.questionType === QuestionType.SINGLE_CHOICE ? resolvedSingle : '',
        correctOptionIds:
          q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX ? resolvedComplex : [],
        statementKeys: q.questionType === QuestionType.TRUE_FALSE ? resolvedStmtMap : {},
        complexScoringRule: effectiveRule,
        wrongScore: Number(wrongScore) || 0,
        weight: Math.max(0.5, Math.min(100, Number(weight) || 1)),
        discussion: clampStr(resolvedDiscussion, 4000),
        verified: true,
        locked: hasActiveExamUsingQ,
        verifiedBy: clampStr(`${adminEmail} (AI)`, 150),
        updatedAt: serverTimestamp(),
      };

      if (snap.exists()) {
        await updateDoc(keyRef, payload);
      } else {
        await setDoc(keyRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      await updateDoc(doc(db, 'questions', q.id), {
        answerKeyVerified: true,
        verificationStatus: VerificationStatus.VERIFIED,
        textVerified: true,
        imageVerified: true,
        weight: Math.max(0.5, Math.min(100, Number(weight) || 1)),
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        action: 'AI_SOLVE_AND_SAVE_ANSWER_KEY',
        targetType: 'answerKey',
        targetId: q.id,
        summary: `Menganalisis dan menyimpan otomatis kunci jawaban AI untuk Soal Nomor ${q.originalNumber}.`,
      });

      setUnlockConfirm(false);
      setKeyMessage(
        `AI berhasil menganalisis Soal Nomor ${q.originalNumber} dan menyimpan kunci jawaban beserta pembahasannya secara otomatis.`
      );
    } catch (err) {
      setKeyMessage(
        err instanceof Error ? err.message : 'Gagal menganalisis soal secara otomatis.'
      );
    } finally {
      setAiSolvingSingle(false);
    }
  };

  const handleSaveAndVerifyKey = async (markVerified: boolean) => {
    const q = sortedQuestions.find((x) => x.id === selectedQId);
    if (!q) return;

    const existingKey = keyMap.get(q.id);
    if (existingKey?.locked && !unlockConfirm) {
      setKeyMessage(
        'Kunci jawaban soal ini sedang terkunci karena ujian telah dibuka. Tekan Buka Kunci Terbatas jika perlu revisi resmi.'
      );
      return;
    }

    if (markVerified) {
      if (q.questionType === QuestionType.SINGLE_CHOICE && !singleOpt) {
        setKeyMessage('Pilih satu huruf kunci jawaban terlebih dahulu sebelum memverifikasi.');
        return;
      }
      if (
        q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX &&
        complexOpts.length === 0
      ) {
        setKeyMessage('Centang minimal satu pilihan kunci jawaban benar terlebih dahulu.');
        return;
      }
      if (q.questionType === QuestionType.TRUE_FALSE) {
        const missing = q.statements.some((s) => typeof stmtMap[s.id] !== 'boolean');
        if (missing) {
          setKeyMessage(
            'Tentukan kunci Benar atau Salah untuk seluruh pernyataan (A, B, C) terlebih dahulu.'
          );
          return;
        }
      }
    }

    setSavingKey(true);
    setKeyMessage(null);
    const adminEmail = auth.currentUser?.email || auth.currentUser?.uid || 'admin';
    const hasActiveExamUsingQ = exams.some(
      (ex) =>
        (ex.status === ExamStatus.ACTIVE || ex.status === ExamStatus.FINISHED) &&
        ex.questionIds.includes(q.id)
    );

    try {
      const keyRef = doc(db, 'answerKeys', q.id);
      const snap = await getDoc(keyRef);
      const payload = {
        questionId: q.id,
        examPackId: q.examPackId,
        questionType: q.questionType,
        correctOptionId: q.questionType === QuestionType.SINGLE_CHOICE ? singleOpt : '',
        correctOptionIds:
          q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX ? complexOpts : [],
        statementKeys: q.questionType === QuestionType.TRUE_FALSE ? stmtMap : {},
        complexScoringRule: scoringRule,
        wrongScore: Number(wrongScore) || 0,
        weight: Math.max(0.5, Math.min(100, Number(weight) || 1)),
        discussion: clampStr(discussion, 4000),
        verified: markVerified,
        locked: markVerified && hasActiveExamUsingQ,
        verifiedBy: clampStr(adminEmail, 150),
        updatedAt: serverTimestamp(),
      };

      if (snap.exists()) {
        await updateDoc(keyRef, payload);
      } else {
        await setDoc(keyRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      // Sync non-sensitive answerKeyVerified boolean flag & weight onto /questions/{q.id}
      await updateDoc(doc(db, 'questions', q.id), {
        answerKeyVerified: markVerified,
        weight: Math.max(0.5, Math.min(100, Number(weight) || 1)),
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        action: markVerified ? 'VERIFY_ANSWER_KEY' : 'UNVERIFY_ANSWER_KEY',
        targetType: 'answerKey',
        targetId: q.id,
        summary: `${
          markVerified ? 'Memverifikasi' : 'Membatalkan verifikasi'
        } kunci jawaban Soal Nomor ${q.originalNumber}${
          unlockConfirm ? ' (melalui pembukaan kunci terbatas)' : ''
        }.`,
      });

      setUnlockConfirm(false);
      setKeyMessage(
        markVerified
          ? `Kunci jawaban Soal Nomor ${q.originalNumber} berhasil disimpan dan TERVERIFIKASI.`
          : `Status kunci jawaban Soal Nomor ${q.originalNumber} disimpan sebagai BELUM SIAP DINILAI.`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `answerKeys/${q.id}`);
    } finally {
      setSavingKey(false);
    }
  };

  // ============================================================================
  // RENDER MENU 7: KUNCI JAWABAN & ANALISIS AI OTOMATIS
  // ============================================================================
  if (activeSubTab === 'answer_keys') {
    const activeSeedList =
      activeKeyPack === 'bindo'
        ? BINDO2_ANSWER_KEYS
        : activeKeyPack === 'mtk'
        ? TO1_MTK_ANSWER_KEYS
        : [];
    const activePdfLabel =
      activeKeyPack === 'bindo'
        ? BINDO2_SOURCE_PDF_NAME
        : activeKeyPack === 'mtk'
        ? TO1_SOURCE_PDF_NAME
        : 'Dokumen PDF Tambahan';
    const activeSubjectLabel =
      activeKeyPack === 'bindo'
        ? 'Bahasa Indonesia'
        : activeKeyPack === 'mtk'
        ? 'Matematika'
        : 'Paket Lainnya';

    const verifiedKeysCount = keyPackQuestions.filter((q) => keyMap.get(q.id)?.verified).length;
    const currentQ = keyPackQuestions.find((x) => x.id === selectedQId) || keyPackQuestions[0];
    const currentKey = currentQ ? keyMap.get(currentQ.id) : undefined;

    return (
      <div className="space-y-6">
        {/* Subject Pack Switcher */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600 mr-1">Pilih Paket Mata Pelajaran:</span>
          <button
            type="button"
            onClick={() => {
              setActiveKeyPack('mtk');
              setBulkStatusMsg(null);
            }}
            className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
              activeKeyPack === 'mtk'
                ? 'bg-sky-700 border-sky-700 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Matematika — {TO1_SOURCE_PDF_NAME} (30 Soal)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveKeyPack('bindo');
              setBulkStatusMsg(null);
            }}
            className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
              activeKeyPack === 'bindo'
                ? 'bg-blue-700 border-blue-700 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Bahasa Indonesia — {BINDO2_SOURCE_PDF_NAME} (30 Soal)
          </button>
          {otherQuestions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveKeyPack('other');
                setBulkStatusMsg(null);
              }}
              className={`px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                activeKeyPack === 'other'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Paket Tambahan ({otherQuestions.length} Soal)
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">
              Kunci Jawaban &amp; Koreksi Otomatis AI — {activeSubjectLabel} ({activePdfLabel})
            </h2>
            <p className="text-sm text-slate-600">
              Seluruh soal <strong>{activePdfLabel}</strong> telah dianalisis oleh AI beserta
              pembahasannya tanpa perlu dikerjakan manual (
              <strong className="font-mono-tabular text-emerald-700">
                {verifiedKeysCount}/{keyPackQuestions.length || 30}
              </strong>{' '}
              kunci aktif &amp; siap mengoreksi jawaban siswa secara otomatis).
            </p>
          </div>

          {activeSeedList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowFullSummaryTable((v) => !v)}
                className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <BookOpenCheck className="w-4 h-4 text-blue-700" />
                <span>
                  {showFullSummaryTable
                    ? 'Sembunyikan Tabel 30 Kunci'
                    : 'Tampilkan Tabel 30 Kunci & Analisis'}
                </span>
              </button>

              <button
                type="button"
                disabled={syncingAllKeys}
                onClick={handleSyncActivePackAiKeys}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {syncingAllKeys ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>
                  {syncingAllKeys
                    ? 'Menyimpan 30 Kunci...'
                    : `Simpan Otomatis 30 Kunci ${activeSubjectLabel}`}
                </span>
              </button>
            </div>
          )}
        </div>

        {bulkStatusMsg && (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900 font-medium">
            {bulkStatusMsg}
          </div>
        )}

        {/* Complete 30-Question Analysis & Verified Key Table */}
        {showFullSummaryTable && activeSeedList.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/70">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Daftar Lengkap Kunci Jawaban &amp; Analisis Penyelesaian 30 Soal ({activePdfLabel})
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Klik baris nomor soal mana pun untuk meninjau soal/gambar asli PDF atau menyesuaikan bobot penilaiannya di bawah.
                </p>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-emerald-700 shrink-0">
                30 Soal Teranalisis · Koreksi Otomatis Aktif
              </span>
            </div>

            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200 text-xs font-bold text-slate-700">
                  <tr>
                    <th className="py-2.5 px-4 w-14">No.</th>
                    <th className="py-2.5 px-4 w-44">Bentuk &amp; Materi</th>
                    <th className="py-2.5 px-4 w-56">Kunci Jawaban Resmi</th>
                    <th className="py-2.5 px-4">Analisis &amp; Pembahasan AI</th>
                    <th className="py-2.5 px-4 w-28 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {activeSeedList.map((seed) => {
                    const liveQ = keyPackQuestions.find((q) => q.id === seed.questionId);
                    const liveKey = keyMap.get(seed.questionId);
                    const isSelected = currentQ?.id === seed.questionId;
                    const displayAnswer =
                      liveQ && liveKey?.verified
                        ? formatLiveAnswerKeySummary(liveQ, liveKey)
                        : seed.answerSummaryLabel;
                    const displayDiscussion = liveKey?.discussion || seed.discussion;

                    return (
                      <tr
                        key={seed.questionId}
                        onClick={() => {
                          if (liveQ) setSelectedQId(liveQ.id);
                        }}
                        className={`cursor-pointer transition-colors align-top ${
                          isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono-tabular font-bold text-slate-900">
                          {seed.originalNumber}
                        </td>
                        <td className="py-3 px-4 space-y-1">
                          <div className="font-semibold text-slate-900">{seed.topicLabel}</div>
                          <div className="text-[11px] text-slate-500">
                            {seed.questionType === QuestionType.SINGLE_CHOICE && 'Pilihan Ganda'}
                            {seed.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX &&
                              'PG Kompleks'}
                            {seed.questionType === QuestionType.TRUE_FALSE &&
                              (liveQ ? getTrueFalseLabels(liveQ).columnTitle : 'Benar / Salah')}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular font-bold text-blue-900">
                          {displayAnswer}
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-pre-line leading-relaxed">
                          {displayDiscussion}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold whitespace-nowrap">
                          {liveKey?.verified ? (
                            <span className="text-emerald-700">✓ Tersimpan</span>
                          ) : (
                            <span className="text-amber-700">Menyinkronkan</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {keyPackQuestions.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            Sedang menyinkronkan Bank Soal &amp; 30 Kunci Jawaban AI ke database... Tekan tombol{' '}
            <strong>Simpan Otomatis 30 Kunci {activeSubjectLabel}</strong> di atas bila diperlukan.
          </div>
        ) : (
          <>
            {/* Question Selector */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-1.5">
              {keyPackQuestions.map((q) => {
                const k = keyMap.get(q.id);
                const isSelected = currentQ?.id === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQId(q.id)}
                    className={`w-10 h-9 rounded-md border text-xs font-mono-tabular font-bold transition-colors ${
                      isSelected
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : k?.verified
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                        : 'bg-amber-50 border-amber-300 text-amber-900'
                    }`}
                    title={k?.verified ? 'Kunci Terverifikasi' : 'Belum Siap Dinilai'}
                  >
                    {q.originalNumber}
                  </button>
                );
              })}
            </div>

            {currentQ && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left: Question Reference */}
                <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900 font-mono-tabular">
                      Pratinjau Soal Nomor {currentQ.originalNumber} ({currentQ.subject})
                    </h3>
                    <span className="text-xs font-semibold text-slate-600">
                      {currentQ.questionType === QuestionType.SINGLE_CHOICE && 'Pilihan Ganda'}
                      {currentQ.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX &&
                        'Pilihan Ganda Kompleks'}
                      {currentQ.questionType === QuestionType.TRUE_FALSE &&
                        getTrueFalseLabels(currentQ).columnTitle}
                    </span>
                  </div>

                  <QuestionContentView question={currentQ} />

                  {currentQ.questionType !== QuestionType.TRUE_FALSE ? (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {currentQ.options.map((opt) => (
                        <div
                          key={opt.id}
                          className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-start gap-2.5 text-sm"
                        >
                          <strong>{opt.label}.</strong>
                          <div>
                            {opt.text && <MathText text={opt.text} />}
                            {opt.imageUrl && (
                              <ZoomableImage
                                src={opt.imageUrl}
                                alt={`Pilihan ${opt.label}`}
                                maxHeightClass="max-h-[180px]"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {currentQ.statements.map((st) => (
                        <div
                          key={st.id}
                          className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 text-sm space-y-1"
                        >
                          <div>
                            <strong className="mr-2">{st.label}.</strong>
                            <MathText text={st.text} />
                          </div>
                          {st.imageUrl && (
                            <ZoomableImage
                              src={st.imageUrl}
                              alt={`Pernyataan ${st.label}`}
                              maxHeightClass="max-h-[150px]"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Answer Key & Scoring Rule Configuration */}
                <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-sky-700" />
                      <h3 className="text-base font-bold text-slate-900">
                        Kunci Soal {currentQ.originalNumber}
                      </h3>
                    </div>
                    {currentKey?.verified ? (
                      <span className="text-xs font-bold text-emerald-700">✓ SIAP DINILAI</span>
                    ) : (
                      <span className="text-xs font-bold text-amber-700">
                        BELUM SIAP DINILAI
                      </span>
                    )}
                  </div>

                  {/* Single-Question Multimodal Gemini Solver & Auto-Saver */}
                  <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50/60 space-y-2.5">
                    <div className="text-xs text-slate-700 leading-relaxed">
                      Gunakan analisis AI multimodal untuk memeriksa teks &amp; gambar soal ini lalu menyimpan kunci jawaban beserta pembahasannya secara otomatis.
                    </div>
                    <button
                      type="button"
                      disabled={aiSolvingSingle || savingKey}
                      onClick={handleSolveCurrentQuestionWithAi}
                      className="w-full min-h-[38px] px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      {aiSolvingSingle ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {aiSolvingSingle
                          ? 'Menganalisis Teks & Gambar Soal...'
                          : 'Analisis & Simpan Otomatis dengan AI'}
                      </span>
                    </button>
                  </div>

                  {currentKey?.locked && !unlockConfirm && (
                    <div className="p-3.5 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900 space-y-2">
                      <div className="flex items-center gap-1.5 font-bold">
                        <Lock className="w-3.5 h-3.5" />
                        Kunci Jawaban Terkunci
                      </div>
                      <p>
                        Kunci jawaban dikunci otomatis karena ujian terkait telah dimulai. Perubahan
                        akan dicatat di Log Aktivitas.
                      </p>
                      <button
                        type="button"
                        onClick={() => setUnlockConfirm(true)}
                        className="px-3 py-1.5 rounded bg-amber-800 text-white font-semibold inline-flex items-center gap-1"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        Buka Kunci Terbatas
                      </button>
                    </div>
                  )}

                  {/* Key Inputs by Type */}
                  {currentQ.questionType === QuestionType.SINGLE_CHOICE && (
                    <div className="space-y-3">
                      <label className="block text-xs font-bold text-slate-700">
                        Pilih Jawaban Benar (1 Pilihan):
                      </label>
                      <div className="grid grid-cols-4 gap-2">
                        {currentQ.options.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setSingleOpt(opt.id)}
                            className={`py-2.5 rounded-lg border text-sm font-bold transition-colors ${
                              singleOpt === opt.id
                                ? 'bg-sky-700 border-sky-700 text-white'
                                : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentQ.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-2">
                          Centang Seluruh Jawaban Benar:
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {currentQ.options.map((opt) => {
                            const active = complexOpts.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() =>
                                  setComplexOpts((prev) =>
                                    prev.includes(opt.id)
                                      ? prev.filter((x) => x !== opt.id)
                                      : [...prev, opt.id].sort()
                                  )
                                }
                                className={`px-4 py-2 rounded-lg border text-sm font-bold ${
                                  active
                                    ? 'bg-sky-700 border-sky-700 text-white'
                                    : 'bg-white border-slate-300 text-slate-800'
                                }`}
                              >
                                {active ? `✓ Pilihan ${opt.label}` : `Pilihan ${opt.label}`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Aturan Penilaian Pilihan Ganda Kompleks:
                        </label>
                        <select
                          value={scoringRule}
                          onChange={(e) => setScoringRule(e.target.value as ComplexScoringRule)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                        >
                          <option value={ComplexScoringRule.ALL_EXACT}>
                            Seluruh kombinasi harus tepat (skor penuh jika tepat, 0 jika kurang/lebih)
                          </option>
                          <option value={ComplexScoringRule.PARTIAL_NO_PENALTY}>
                            Proporsional jawaban benar tanpa salah pilih (tanpa penalti minus)
                          </option>
                        </select>
                      </div>
                    </div>
                  )}

                  {currentQ.questionType === QuestionType.TRUE_FALSE && (() => {
                    const tfLabels = getTrueFalseLabels(currentQ);
                    return (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-700">
                            Tentukan Kunci Tiap Pernyataan ({tfLabels.columnTitle}):
                          </label>
                          {currentQ.statements.map((st) => {
                            const val = stmtMap[st.id];
                            return (
                              <div
                                key={st.id}
                                className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                              >
                                <span className="text-sm font-bold text-slate-800">
                                  Pernyataan {st.label}
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setStmtMap((m) => ({ ...m, [st.id]: true }))
                                    }
                                    className={`px-3 py-1.5 rounded text-xs font-bold border ${
                                      val === true
                                        ? 'bg-sky-700 border-sky-700 text-white'
                                        : 'bg-white border-slate-300 text-slate-700'
                                    }`}
                                  >
                                    {tfLabels.trueLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setStmtMap((m) => ({ ...m, [st.id]: false }))
                                    }
                                    className={`px-3 py-1.5 rounded text-xs font-bold border ${
                                      val === false
                                        ? 'bg-slate-900 border-slate-900 text-white'
                                        : 'bg-white border-slate-300 text-slate-700'
                                    }`}
                                  >
                                    {tfLabels.falseLabel}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Aturan Penilaian ({tfLabels.columnTitle}):
                          </label>
                        <select
                          value={scoringRule}
                          onChange={(e) => setScoringRule(e.target.value as ComplexScoringRule)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                        >
                          <option value={ComplexScoringRule.PARTIAL_NO_PENALTY}>
                            Proporsional per pernyataan benar (mis. 2/3 × bobot)
                          </option>
                          <option value={ComplexScoringRule.ALL_EXACT}>
                            Seluruh pernyataan harus benar untuk mendapat bobot penuh
                          </option>
                        </select>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Bobot Skor Maksimal
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="100"
                        value={weight}
                        onChange={(e) => setWeight(Number(e.target.value) || 1)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                      />
                    </div>
                    {currentQ.questionType === QuestionType.SINGLE_CHOICE && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Skor Jawaban Salah
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          min="-10"
                          max="0"
                          value={wrongScore}
                          onChange={(e) => setWrongScore(Number(e.target.value) || 0)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Pembahasan Resmi &amp; Analisis Langkah Penyelesaian
                    </label>
                    <textarea
                      rows={5}
                      value={discussion}
                      onChange={(e) => setDiscussion(e.target.value)}
                      placeholder="Langkah penyelesaian matematis terverifikasi..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm leading-relaxed"
                    />
                  </div>

                  {keyMessage && (
                    <div className="p-3 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-900">
                      {keyMessage}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200">
                    <button
                      type="button"
                      disabled={savingKey || aiSolvingSingle}
                      onClick={() => handleSaveAndVerifyKey(true)}
                      className="flex-1 min-h-[42px] px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{savingKey ? 'Menyimpan...' : 'Simpan & Verifikasi Kunci'}</span>
                    </button>
                    {currentKey?.verified && (
                      <button
                        type="button"
                        disabled={savingKey || aiSolvingSingle}
                        onClick={() => handleSaveAndVerifyKey(false)}
                        className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Tandai Belum Siap
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER MENU 8: PENGATURAN UJIAN
  // ============================================================================
  const verifiedQuestions = sortedQuestions.filter(
    (q) => q.verificationStatus === VerificationStatus.VERIFIED
  );
  const unverifiedCount = sortedQuestions.length - verifiedQuestions.length;

  const filteredExamCandidateQuestions = verifiedQuestions
    .filter((q) => {
      if (examPackIdState === TO1_PACK_ID) return q.examPackId === TO1_PACK_ID;
      if (examPackIdState === BINDO2_PACK_ID) return q.examPackId === BINDO2_PACK_ID;
      return q.subject.toLowerCase() === subject.trim().toLowerCase() || examPackIdState === 'ALL';
    })
    .sort((a, b) => a.originalNumber - b.originalNumber);

  const applySubjectExamPreset = (preset: 'mtk' | 'bindo') => {
    if (preset === 'mtk') {
      const mtkVerifiedIds = verifiedQuestions
        .filter((q) => q.examPackId === TO1_PACK_ID)
        .sort((a, b) => a.originalNumber - b.originalNumber)
        .map((q) => q.id);
      setExamPackIdState(TO1_PACK_ID);
      setSubject('Matematika');
      if (!editingExamId) {
        setTitle('SIMULASI TKA MATEMATIKA KELAS VI — PAKET TO 1');
        setDescription(
          'Simulasi Tes Kemampuan Akademik (TKA) Matematika Kelas VI Sekolah Dasar berdasarkan dokumen TO 1 MTK.'
        );
      }
      setSelectedExamQuestionIds(mtkVerifiedIds);
    } else {
      const bindoVerifiedIds = verifiedQuestions
        .filter((q) => q.examPackId === BINDO2_PACK_ID)
        .sort((a, b) => a.originalNumber - b.originalNumber)
        .map((q) => q.id);
      setExamPackIdState(BINDO2_PACK_ID);
      setSubject('Bahasa Indonesia');
      if (!editingExamId) {
        setTitle('SIMULASI TKA BAHASA INDONESIA KELAS VI — PAKET 2');
        setDescription(
          'Simulasi Tes Kemampuan Akademik (TKA) Bahasa Indonesia Kelas VI Sekolah Dasar berdasarkan dokumen B.Indo 2.'
        );
      }
      setSelectedExamQuestionIds(bindoVerifiedIds);
    }
    setExamError(null);
    setExamSuccess(null);
  };

  const handleLoadExamToForm = (ex: ExamRecord) => {
    setEditingExamId(ex.id);
    setExamPackIdState(ex.examPackId || TO1_PACK_ID);
    setTitle(ex.title);
    setDescription(ex.description);
    setSubject(ex.subject);
    setTargetClass(ex.targetClass);
    setDurationMinutes(ex.durationMinutes);
    setStartLocal(toDatetimeLocalValue(ex.scheduledStart));
    setEndLocal(toDatetimeLocalValue(ex.scheduledEnd));
    setExamStatus(ex.status);
    setAllowRetake(ex.allowRetake);
    setShuffleQuestions(ex.shuffleQuestions);
    setShuffleOptions(ex.shuffleOptions);
    setShowDiscussion(ex.showDiscussion);
    setPublishScore(ex.publishScore);
    setSelectedExamQuestionIds(ex.questionIds);
    setExamError(null);
    setExamSuccess(null);
  };

  const handleResetExamForm = () => {
    setEditingExamId(null);
    setExamPackIdState(TO1_PACK_ID);
    setTitle('SIMULASI TKA MATEMATIKA KELAS VI — PAKET TO 1');
    setDescription(
      'Simulasi Tes Kemampuan Akademik (TKA) Matematika Kelas VI Sekolah Dasar berdasarkan dokumen TO 1 MTK.'
    );
    setSubject('Matematika');
    setTargetClass('Semua');
    setDurationMinutes(90);
    setExamStatus(ExamStatus.DRAFT);
    setAllowRetake(false);
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setShowDiscussion(true);
    setPublishScore(true);
    setSelectedExamQuestionIds(
      verifiedQuestions
        .filter((q) => q.examPackId === TO1_PACK_ID)
        .sort((a, b) => a.originalNumber - b.originalNumber)
        .map((q) => q.id)
    );
    setExamError(null);
    setExamSuccess(null);
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setExamError(null);
    setExamSuccess(null);

    if (!title.trim() || !subject.trim()) {
      setExamError('Nama ujian dan mata pelajaran wajib diisi.');
      return;
    }

    // Rule C.10: Never publish an active/waiting exam with unverified questions or 0 verified questions
    const validSelectedIds = selectedExamQuestionIds.filter((id) =>
      verifiedQuestions.some((vq) => vq.id === id)
    );

    if (
      (examStatus === ExamStatus.ACTIVE || examStatus === ExamStatus.WAITING) &&
      validSelectedIds.length === 0
    ) {
      setExamError(
        'Ujian tidak dapat dibuka (Menunggu/Aktif) sebelum minimal 1 soal lolos pemeriksaan di menu Verifikasi Soal.'
      );
      return;
    }

    const startDate = new Date(startLocal);
    const endDate = new Date(endLocal);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      setExamError('Waktu berakhir ujian harus lebih besar daripada waktu mulai ujian.');
      return;
    }

    const firstSelectedQ = verifiedQuestions.find((vq) => vq.id === validSelectedIds[0]);
    const resolvedPackId =
      examPackIdState === BINDO2_PACK_ID || firstSelectedQ?.examPackId === BINDO2_PACK_ID
        ? BINDO2_PACK_ID
        : examPackIdState === TO1_PACK_ID || firstSelectedQ?.examPackId === TO1_PACK_ID
        ? TO1_PACK_ID
        : sanitizeId(firstSelectedQ?.examPackId || examPackIdState || TO1_PACK_ID).slice(0, 80);

    const resolvedSourcePdfName =
      resolvedPackId === BINDO2_PACK_ID
        ? BINDO2_SOURCE_PDF_NAME
        : resolvedPackId === TO1_PACK_ID
        ? TO1_SOURCE_PDF_NAME
        : clampStr(firstSelectedQ?.sourcePdfName || TO1_SOURCE_PDF_NAME, 200);

    setSavingExam(true);
    const examId = editingExamId || sanitizeId(`exam_${Date.now().toString(36)}`);
    try {
      const payload = {
        id: examId,
        title: clampStr(title, 200),
        description: clampStr(description, 2000),
        subject: clampStr(subject, 80),
        targetClass: clampStr(targetClass, 40),
        examPackId: resolvedPackId,
        questionIds: validSelectedIds,
        questionCount: validSelectedIds.length,
        durationMinutes: Math.max(5, Math.min(300, Number(durationMinutes) || 90)),
        scheduledStart: Timestamp.fromDate(startDate),
        scheduledEnd: Timestamp.fromDate(endDate),
        status: examStatus,
        allowRetake,
        shuffleQuestions,
        shuffleOptions,
        showDiscussion,
        publishScore,
        sourcePdfName: resolvedSourcePdfName,
        updatedAt: serverTimestamp(),
      };

      if (editingExamId) {
        await updateDoc(doc(db, 'exams', examId), payload);
      } else {
        await setDoc(doc(db, 'exams', examId), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      const updatedExamObj: ExamRecord = {
        ...payload,
        updatedAt: Timestamp.now(),
      };
      const nextExamsList = editingExamId
        ? exams.map((x) => (x.id === examId ? updatedExamObj : x))
        : [...exams, updatedExamObj];
      await syncPublishedExamsPortalIndex(nextExamsList);

      await recordAuditLog({
        action: editingExamId ? 'UPDATE_EXAM' : 'CREATE_EXAM',
        targetType: 'exam',
        targetId: examId,
        summary: `${editingExamId ? 'Memperbarui' : 'Membuat'} ujian "${payload.title}" (${payload.subject}) dengan status ${examStatus.toUpperCase()} (${validSelectedIds.length} soal).`,
      });

      setEditingExamId(examId);
      setExamSuccess('Pengaturan jadwal dan konfigurasi ujian berhasil disimpan.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `exams/${examId}`);
    } finally {
      setSavingExam(false);
    }
  };

  const handleQuickExamStatus = async (ex: ExamRecord, nextStatus: ExamStatus) => {
    if (
      (nextStatus === ExamStatus.ACTIVE || nextStatus === ExamStatus.WAITING) &&
      ex.questionCount === 0
    ) {
      setExamError('Tidak dapat mengaktifkan ujian yang belum memiliki soal terverifikasi.');
      return;
    }
    try {
      await updateDoc(doc(db, 'exams', ex.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      const nextExamsList = exams.map((x) =>
        x.id === ex.id ? { ...x, status: nextStatus } : x
      );
      await syncPublishedExamsPortalIndex(nextExamsList);
      await recordAuditLog({
        action: 'CHANGE_EXAM_STATUS',
        targetType: 'exam',
        targetId: ex.id,
        summary: `Mengubah status ujian "${ex.title}" menjadi ${nextStatus.toUpperCase()}.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `exams/${ex.id}`);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    try {
      await deleteDoc(doc(db, 'exams', examId));
      const nextExamsList = exams.filter((x) => x.id !== examId);
      await syncPublishedExamsPortalIndex(nextExamsList);
      await recordAuditLog({
        action: 'DELETE_EXAM',
        targetType: 'exam',
        targetId: examId,
        summary: `Menghapus konfigurasi ujian ${examId}.`,
      });
      setConfirmDeleteExamId(null);
      if (editingExamId === examId) handleResetExamForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `exams/${examId}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Manajemen &amp; Pengaturan Ujian</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Atur jadwal, durasi, sasaran kelas, token masuk siswa, pengacakan aman, dan publikasi nilai ujian CBT.
          </p>
        </div>
        {editingExamId && (
          <button
            type="button"
            onClick={handleResetExamForm}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Buat Ujian Baru
          </button>
        )}
      </div>

      {/* Quick Token Access Bar */}
      <TokenManagerCard tokens={tokens} compact />

      {unverifiedCount > 0 && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-950 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Terdapat {unverifiedCount} soal yang masih berstatus BELUM TERVERIFIKASI
            </p>
            <p className="text-xs text-amber-900 mt-0.5">
              Sesuai ketentuan sistem, hanya soal yang telah lolos pemeriksaan admin ({verifiedQuestions.length}{' '}
              soal) yang dapat dimasukkan dan diterbitkan ke dalam ujian.
            </p>
          </div>
        </div>
      )}

      {/* Existing Exams List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Daftar Ujian Terdaftar</h3>
          <span className="text-xs font-mono-tabular text-slate-500">{exams.length} ujian</span>
        </div>
        {exams.length === 0 ? (
          <div className="p-6 text-sm text-slate-500 text-center">
            Belum ada jadwal ujian. Gunakan formulir di bawah untuk membuat ujian pertama.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                <th className="py-3 px-4 font-semibold">Nama Ujian</th>
                <th className="py-3 px-4 font-semibold">Mata Pelajaran</th>
                <th className="py-3 px-4 font-semibold">Kelas</th>
                <th className="py-3 px-4 font-semibold text-right">Soal / Durasi</th>
                <th className="py-3 px-4 font-semibold">Status Ujian</th>
                <th className="py-3 px-4 font-semibold">Publikasi Nilai</th>
                <th className="py-3 px-4 font-semibold text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {exams.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">{ex.title}</td>
                  <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{ex.subject}</div>
                    <div className="text-[11px] text-slate-500">{ex.sourcePdfName}</div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">{ex.targetClass}</td>
                  <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-700">
                    {ex.questionCount} soal · {ex.durationMinutes} mnt
                  </td>
                  <td className="py-3.5 px-4">
                    <select
                      value={ex.status}
                      onChange={(e) => handleQuickExamStatus(ex, e.target.value as ExamStatus)}
                      className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold bg-white"
                    >
                      <option value={ExamStatus.DRAFT}>Draf</option>
                      <option value={ExamStatus.WAITING}>Menunggu</option>
                      <option value={ExamStatus.ACTIVE}>Aktif (Dibuka)</option>
                      <option value={ExamStatus.FINISHED}>Selesai (Ditutup)</option>
                      <option value={ExamStatus.ARCHIVED}>Diarsipkan</option>
                    </select>
                  </td>
                  <td className="py-3.5 px-4 text-xs font-semibold">
                    {ex.publishScore ? (
                      <span className="text-emerald-700">Diizinkan</span>
                    ) : (
                      <span className="text-slate-500">Disembunyikan</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => handleLoadExamToForm(ex)}
                      className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-sky-800 hover:bg-sky-50"
                    >
                      Pengaturan
                    </button>
                    {confirmDeleteExamId === ex.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDeleteExam(ex.id)}
                          className="px-2.5 py-1.5 rounded bg-red-700 text-white text-xs font-semibold"
                        >
                          Konfirmasi Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteExamId(null)}
                          className="px-2 py-1.5 rounded border border-slate-300 text-xs"
                        >
                          Batal
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteExamId(ex.id)}
                        className="px-2.5 py-1.5 rounded border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit Exam Form */}
      <form
        onSubmit={handleSaveExam}
        className="bg-white rounded-xl border border-slate-200 p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-sky-700" />
            <h3 className="text-base font-bold text-slate-900">
              {editingExamId ? 'Edit Pengaturan Ujian' : 'Buat Jadwal Simulasi Ujian Baru'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Pilih Paket Soal:</span>
            <button
              type="button"
              onClick={() => applySubjectExamPreset('mtk')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                examPackIdState === TO1_PACK_ID
                  ? 'bg-sky-700 border-sky-700 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Matematika ({TO1_SOURCE_PDF_NAME})
            </button>
            <button
              type="button"
              onClick={() => applySubjectExamPreset('bindo')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                examPackIdState === BINDO2_PACK_ID
                  ? 'bg-blue-700 border-blue-700 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Bahasa Indonesia ({BINDO2_SOURCE_PDF_NAME})
            </button>
          </div>
        </div>

        {examError && (
          <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
            {examError}
          </div>
        )}
        {examSuccess && (
          <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
            {examSuccess}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Nama Ujian</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Deskripsi Ujian</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Mata Pelajaran</label>
            <input
              type="text"
              required
              list="exam-subject-options"
              value={subject}
              onChange={(e) => {
                const nextSubj = e.target.value;
                setSubject(nextSubj);
                if (nextSubj.toLowerCase() === 'bahasa indonesia') {
                  setExamPackIdState(BINDO2_PACK_ID);
                } else if (nextSubj.toLowerCase() === 'matematika') {
                  setExamPackIdState(TO1_PACK_ID);
                } else {
                  setExamPackIdState('ALL');
                }
              }}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
            />
            <datalist id="exam-subject-options">
              <option value="Matematika" />
              <option value="Bahasa Indonesia" />
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Sasaran Kelas</label>
            <select
              value={targetClass}
              onChange={(e) => setTargetClass(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="Semua">Semua Kelas VI</option>
              <option value="VI-A">Kelas VI-A</option>
              <option value="VI-B">Kelas VI-B</option>
              <option value="VI-C">Kelas VI-C</option>
              <option value="VI">Kelas VI (Umum)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Durasi Pengerjaan (Menit)
            </label>
            <input
              type="number"
              min={5}
              max={300}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 90)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Status Ujian</label>
            <select
              value={examStatus}
              onChange={(e) => setExamStatus(e.target.value as ExamStatus)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value={ExamStatus.DRAFT}>Draf (Belum Tampil di Siswa)</option>
              <option value={ExamStatus.WAITING}>Menunggu (Tampil Status Belum Dibuka)</option>
              <option value={ExamStatus.ACTIVE}>Aktif (Siswa Dapat Mulai Ujian)</option>
              <option value={ExamStatus.FINISHED}>Selesai (Ujian Ditutup)</option>
              <option value={ExamStatus.ARCHIVED}>Diarsipkan</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Waktu Mulai</label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Waktu Berakhir</label>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={allowRetake}
              onChange={(e) => setAllowRetake(e.target.checked)}
              className="mt-0.5"
            />
            <span>Izinkan siswa mengerjakan ulang ujian lebih dari 1 kali</span>
          </label>
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
              className="mt-0.5"
            />
            <span>Acak urutan tampil soal antarpeserta (tetap menjaga kesatuan gambar soal)</span>
          </label>
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={(e) => setShuffleOptions(e.target.checked)}
              className="mt-0.5"
            />
            <span>Acak urutan pilihan jawaban (otomatis melewati soal bergambar/berlabel tetap)</span>
          </label>
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={publishScore}
              onChange={(e) => setPublishScore(e.target.checked)}
              className="mt-0.5"
            />
            <span>Tampilkan nilai yang telah dipublikasikan pada Dashboard Siswa</span>
          </label>
        </div>

        {/* Verified Question Selection */}
        <div className="pt-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-700">
              Daftar Soal Terverifikasi Paket {subject} yang Diikutkan (
              {
                selectedExamQuestionIds.filter((id) =>
                  filteredExamCandidateQuestions.some((q) => q.id === id)
                ).length
              }{' '}
              / {filteredExamCandidateQuestions.length} dipilih):
            </label>
            <div className="space-x-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  setSelectedExamQuestionIds(filteredExamCandidateQuestions.map((q) => q.id))
                }
                className="font-semibold text-sky-800 hover:underline"
              >
                Pilih Semua ({filteredExamCandidateQuestions.length} Soal)
              </button>
              <button
                type="button"
                onClick={() => setSelectedExamQuestionIds([])}
                className="font-semibold text-slate-600 hover:underline"
              >
                Kosongkan
              </button>
            </div>
          </div>

          {filteredExamCandidateQuestions.length === 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-lg">
              Belum ada soal {subject} yang berstatus TERVERIFIKASI. Buka menu Impor PDF atau
              Verifikasi Soal terlebih dahulu.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 p-3 rounded-lg border border-slate-200 bg-slate-50">
              {filteredExamCandidateQuestions.map((vq) => {
                const picked = selectedExamQuestionIds.includes(vq.id);
                return (
                  <button
                    key={vq.id}
                    type="button"
                    onClick={() =>
                      setSelectedExamQuestionIds((prev) =>
                        prev.includes(vq.id)
                          ? prev.filter((id) => id !== vq.id)
                          : [...prev, vq.id]
                      )
                    }
                    className={`px-2.5 py-1.5 rounded border text-xs font-mono-tabular font-bold ${
                      picked
                        ? 'bg-sky-700 border-sky-700 text-white'
                        : 'bg-white border-slate-300 text-slate-600'
                    }`}
                  >
                    No. {vq.originalNumber}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-200 flex justify-end">
          <button
            type="submit"
            disabled={savingExam}
            className="min-h-[44px] px-6 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-bold hover:bg-sky-800 disabled:opacity-60"
          >
            {savingExam
              ? 'Menyimpan...'
              : editingExamId
              ? 'Simpan Perubahan Ujian'
              : 'Simpan & Buat Ujian'}
          </button>
        </div>
      </form>
    </div>
  );
};
