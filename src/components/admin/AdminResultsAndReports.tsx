import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Printer,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  recordAuditLog,
} from '../../lib/firebase';
import {
  AnswerKeyRecord,
  AttemptRecord,
  ExamGradeRecord,
  ExamRecord,
  QuestionRecord,
  QuestionType,
  ResponseRecord,
  StudentDirectoryRecord,
  UserProfile,
} from '../../types/cbt';
import { AttemptGradingResult, evaluateAttemptGrades } from '../../lib/gradingEngine';
import { getTrueFalseLabels } from '../../lib/trueFalseLabels';
import { MathText } from '../MathText';

interface AdminResultsAndReportsProps {
  activeSubTab: 'participants' | 'exam_results' | 'score_recap' | 'export_reports';
  exams: ExamRecord[];
  questions: QuestionRecord[];
  answerKeys: AnswerKeyRecord[];
  attempts: AttemptRecord[];
  examGrades: ExamGradeRecord[];
  users: UserProfile[];
  studentDirectory: StudentDirectoryRecord[];
}

interface RosterStatusRow {
  studentKey: string;
  fullName: string;
  participantNumber: string;
  className: string;
  schoolName: string;
  attempt: AttemptRecord | null;
  grade: ExamGradeRecord | null;
}

function formatDateTime(ts?: { toDate?: () => Date }): string {
  if (!ts || typeof ts.toDate !== 'function') return '-';
  const d = ts.toDate();
  if (d.getTime() <= 1000) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStudentResponseText(
  q: QuestionRecord,
  resp?: ResponseRecord
): string {
  if (!resp) return 'Kosong';
  if (q.questionType === QuestionType.SINGLE_CHOICE) {
    return resp.selectedOptionId || 'Kosong';
  }
  if (q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX) {
    return resp.selectedOptionIds && resp.selectedOptionIds.length > 0
      ? resp.selectedOptionIds.join(', ')
      : 'Kosong';
  }
  if (q.questionType === QuestionType.TRUE_FALSE) {
    if (!resp.statementAnswers) return 'Kosong';
    const tfLabels = getTrueFalseLabels(q);
    const parts = q.statements.map((st) => {
      const val = resp.statementAnswers[st.id];
      return `${st.label}: ${
        val === 'true' ? tfLabels.trueLabel : val === 'false' ? tfLabels.falseLabel : '-'
      }`;
    });
    return parts.join(' · ');
  }
  return '-';
}

function formatVerifiedKeyText(q: QuestionRecord, key?: AnswerKeyRecord): string {
  if (!key || !key.verified) return 'BELUM DIVERIFIKASI';
  if (q.questionType === QuestionType.SINGLE_CHOICE) {
    return key.correctOptionId || '-';
  }
  if (q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX) {
    return (key.correctOptionIds || []).join(', ') || '-';
  }
  if (q.questionType === QuestionType.TRUE_FALSE) {
    const tfLabels = getTrueFalseLabels(q);
    return q.statements
      .map(
        (st) =>
          `${st.label}: ${
            key.statementKeys?.[st.id] ? tfLabels.trueLabel : tfLabels.falseLabel
          }`
      )
      .join(' · ');
  }
  return '-';
}

export const AdminResultsAndReports: React.FC<AdminResultsAndReportsProps> = ({
  activeSubTab,
  exams,
  questions,
  answerKeys,
  attempts,
  examGrades,
  users,
  studentDirectory,
}) => {
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'name_asc' | 'score_desc' | 'score_asc'>('score_desc');

  const [gradingBusy, setGradingBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmPublishModal, setConfirmPublishModal] = useState(false);

  // Per-attempt detailed inspection modal
  const [inspectAttempt, setInspectAttempt] = useState<AttemptRecord | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectResponses, setInspectResponses] = useState<Record<string, ResponseRecord>>({});
  const [inspectBreakdown, setInspectBreakdown] = useState<AttemptGradingResult | null>(null);

  useEffect(() => {
    if (!selectedExamId && exams.length > 0) {
      setSelectedExamId(exams[0].id);
    }
  }, [exams, selectedExamId]);

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) || null,
    [exams, selectedExamId]
  );

  const examQuestions = useMemo(() => {
    if (!selectedExam) return [];
    const qSet = new Set(selectedExam.questionIds);
    return questions
      .filter((q) => qSet.has(q.id))
      .sort((a, b) => a.originalNumber - b.originalNumber);
  }, [selectedExam, questions]);

  const answerKeysByQuestionId = useMemo(() => {
    const map: Record<string, AnswerKeyRecord | undefined> = {};
    for (const k of answerKeys) {
      map[k.questionId] = k;
    }
    return map;
  }, [answerKeys]);

  const unverifiedKeyQuestions = useMemo(() => {
    return examQuestions.filter((q) => {
      const k = answerKeysByQuestionId[q.id];
      return !k || !k.verified;
    });
  }, [examQuestions, answerKeysByQuestionId]);

  const gradesByAttemptId = useMemo(() => {
    const map = new Map<string, ExamGradeRecord>();
    for (const g of examGrades) {
      map.set(g.attemptId, g);
    }
    return map;
  }, [examGrades]);

  const examAttempts = useMemo(() => {
    if (!selectedExam) return [];
    return attempts.filter((a) => a.examId === selectedExam.id);
  }, [attempts, selectedExam]);

  // Build unified roster rows combining registered students in studentDirectory + actual attempts
  const rosterRows = useMemo<RosterStatusRow[]>(() => {
    if (!selectedExam) return [];
    const rows: RosterStatusRow[] = [];
    const matchedAttemptIds = new Set<string>();

    const attemptByUid = new Map<string, AttemptRecord>();
    const attemptByParticipant = new Map<string, AttemptRecord>();
    for (const att of examAttempts) {
      const prev = attemptByUid.get(att.studentUid);
      if (
        !prev ||
        (att.startedAt?.toMillis?.() || 0) >= (prev.startedAt?.toMillis?.() || 0)
      ) {
        attemptByUid.set(att.studentUid, att);
      }
      attemptByParticipant.set(att.participantNumber, att);
    }

    for (const dir of studentDirectory) {
      const targetCls = selectedExam.targetClass.trim().toUpperCase();
      const studentCls = dir.className.trim();
      const att =
        attemptByUid.get(dir.id) ||
        attemptByParticipant.get(dir.participantNumber) ||
        null;

      if (
        targetCls !== 'SEMUA' &&
        targetCls !== 'ALL' &&
        targetCls !== 'VI' &&
        studentCls.toUpperCase() !== targetCls
      ) {
        if (!att) continue;
      }

      if (att) matchedAttemptIds.add(att.id);

      rows.push({
        studentKey: `dir_${dir.id}`,
        fullName: dir.fullName,
        participantNumber: dir.participantNumber,
        className: studentCls,
        schoolName: dir.schoolName,
        attempt: att,
        grade: att ? gradesByAttemptId.get(att.id) || null : null,
      });
    }

    // Include any extra attempts (e.g. multiple retakes or renamed participants)
    for (const att of examAttempts) {
      if (matchedAttemptIds.has(att.id)) continue;
      rows.push({
        studentKey: `att_${att.id}`,
        fullName: att.studentName,
        participantNumber: att.participantNumber,
        className: att.className,
        schoolName: att.schoolName,
        attempt: att,
        grade: gradesByAttemptId.get(att.id) || null,
      });
    }

    return rows;
  }, [selectedExam, studentDirectory, examAttempts, gradesByAttemptId]);

  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    rosterRows.forEach((r) => {
      if (r.className) set.add(r.className);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [rosterRows]);

  const filteredRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = rosterRows.filter((r) => {
      if (classFilter !== 'ALL' && r.className !== classFilter) return false;
      if (!q) return true;
      return (
        r.fullName.toLowerCase().includes(q) ||
        r.participantNumber.toLowerCase().includes(q) ||
        r.className.toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return a.fullName.localeCompare(b.fullName, 'id');
      }
      const scoreA = a.grade ? a.grade.finalScore : -1;
      const scoreB = b.grade ? b.grade.finalScore : -1;
      if (sortBy === 'score_desc') {
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.fullName.localeCompare(b.fullName, 'id');
      }
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.fullName.localeCompare(b.fullName, 'id');
    });
  }, [rosterRows, classFilter, searchQuery, sortBy]);

  // Run Automatic Grading on all attempts of the selected exam
  const handleRunAutoGrading = async () => {
    if (!selectedExam) return;
    if (examAttempts.length === 0) {
      setFeedback({
        type: 'err',
        text: 'Belum ada peserta yang mengerjakan ujian ini untuk dinilai.',
      });
      return;
    }

    const graderEmail = auth.currentUser?.email || 'admin';
    setGradingBusy(true);
    setFeedback(null);
    try {
      let gradedCount = 0;
      for (const att of examAttempts) {
        const respSnap = await getDocs(collection(db, 'attempts', att.id, 'responses'));
        const responsesByQuestionId: Record<string, ResponseRecord> = {};
        respSnap.forEach((d) => {
          const data = d.data() as ResponseRecord;
          const qId = data.questionId || d.id;
          const prev = responsesByQuestionId[qId];
          if (
            !prev ||
            (data.sessionId === att.sessionId && prev.sessionId !== att.sessionId) ||
            (data.clientSequence || 0) >= (prev.clientSequence || 0)
          ) {
            responsesByQuestionId[qId] = data;
          }
        });

        const evaluation = evaluateAttemptGrades({
          questions: examQuestions,
          responsesByQuestionId,
          answerKeysByQuestionId,
        });

        const existingGrade = gradesByAttemptId.get(att.id);
        const gradeDocRef = doc(db, 'examGrades', att.id);

        if (existingGrade) {
          await updateDoc(gradeDocRef, {
            correctCount: Math.round(evaluation.correctCount),
            wrongCount: Math.round(evaluation.wrongCount),
            unansweredCount: Math.round(evaluation.unansweredCount),
            rawScore: evaluation.rawScore,
            maxScore: evaluation.maxScore,
            finalScore: evaluation.finalScore,
            gradingStatus: evaluation.gradingStatus,
            unverifiedKeyCount: Math.round(evaluation.unverifiedKeyCount),
            gradedBy: graderEmail,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(gradeDocRef, {
            attemptId: att.id,
            examId: att.examId,
            studentUid: att.studentUid,
            correctCount: Math.round(evaluation.correctCount),
            wrongCount: Math.round(evaluation.wrongCount),
            unansweredCount: Math.round(evaluation.unansweredCount),
            rawScore: evaluation.rawScore,
            maxScore: evaluation.maxScore,
            finalScore: evaluation.finalScore,
            gradingStatus: evaluation.gradingStatus,
            unverifiedKeyCount: Math.round(evaluation.unverifiedKeyCount),
            gradedBy: graderEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // Keep published values in sync if already published
        if (att.scorePublished) {
          await updateDoc(doc(db, 'attempts', att.id), {
            publishedFinalScore: evaluation.finalScore,
            publishedRawScore: evaluation.rawScore,
            publishedMaxScore: evaluation.maxScore,
            publishedCorrectCount: Math.round(evaluation.correctCount),
            publishedWrongCount: Math.round(evaluation.wrongCount),
            scorePublished: true,
            updatedAt: serverTimestamp(),
          });
        }

        gradedCount += 1;
      }

      await recordAuditLog({
        action: 'GRADE_EXAM_ATTEMPTS',
        targetType: 'exams',
        targetId: selectedExam.id,
        summary: `Menjalankan koreksi otomatis pada ${gradedCount} lembar jawaban ujian "${selectedExam.title}" (${unverifiedKeyQuestions.length} kunci belum terverifikasi)`,
      });

      setFeedback({
        type: 'ok',
        text:
          unverifiedKeyQuestions.length > 0
            ? `Koreksi parsial selesai untuk ${gradedCount} peserta. Terdapat ${unverifiedKeyQuestions.length} soal yang kunci jawabannya belum diverifikasi.`
            : `Koreksi otomatis lengkap selesai untuk ${gradedCount} peserta.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'examGrades');
    } finally {
      setGradingBusy(false);
    }
  };

  // Publish or Unpublish Scores to Student Attempts
  const handlePublishScores = async (publish: boolean) => {
    if (!selectedExam) return;
    setPublishBusy(true);
    setFeedback(null);
    try {
      let updated = 0;
      for (const att of examAttempts) {
        const grade = gradesByAttemptId.get(att.id);
        if (publish && !grade) continue;

        await updateDoc(doc(db, 'attempts', att.id), {
          publishedFinalScore: publish && grade ? grade.finalScore : 0,
          publishedRawScore: publish && grade ? grade.rawScore : 0,
          publishedMaxScore: publish && grade ? grade.maxScore : 0,
          publishedCorrectCount: publish && grade ? Math.round(grade.correctCount) : 0,
          publishedWrongCount: publish && grade ? Math.round(grade.wrongCount) : 0,
          scorePublished: publish,
          updatedAt: serverTimestamp(),
        });
        updated += 1;
      }

      await recordAuditLog({
        action: publish ? 'PUBLISH_EXAM_SCORES' : 'UNPUBLISH_EXAM_SCORES',
        targetType: 'exams',
        targetId: selectedExam.id,
        summary: `${publish ? 'Mempublikasikan' : 'Menarik publikasi'} nilai ujian "${selectedExam.title}" untuk ${updated} peserta`,
      });

      setConfirmPublishModal(false);
      setFeedback({
        type: 'ok',
        text: publish
          ? `Nilai ujian berhasil dipublikasikan kepada ${updated} peserta.`
          : `Publikasi nilai ditarik kembali untuk ${updated} peserta.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'attempts');
    } finally {
      setPublishBusy(false);
    }
  };

  const openInspectModal = async (att: AttemptRecord) => {
    setInspectAttempt(att);
    setInspectLoading(true);
    try {
      const snap = await getDocs(collection(db, 'attempts', att.id, 'responses'));
      const map: Record<string, ResponseRecord> = {};
      snap.forEach((d) => {
        const data = d.data() as ResponseRecord;
        const qId = data.questionId || d.id;
        const prev = map[qId];
        if (
          !prev ||
          (data.sessionId === att.sessionId && prev.sessionId !== att.sessionId) ||
          (data.clientSequence || 0) >= (prev.clientSequence || 0)
        ) {
          map[qId] = data;
        }
      });
      setInspectResponses(map);
      setInspectBreakdown(
        evaluateAttemptGrades({
          questions: examQuestions,
          responsesByQuestionId: map,
          answerKeysByQuestionId,
        })
      );
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.LIST,
        `attempts/${att.id}/responses`
      );
    } finally {
      setInspectLoading(false);
    }
  };

  // Summary Statistics for Recap & Reports
  const recapMetrics = useMemo(() => {
    const participated = filteredRoster.filter((r) => r.attempt !== null);
    const notParticipated = filteredRoster.filter((r) => r.attempt === null);
    const gradedScores = participated
      .filter((r) => r.grade && r.grade.gradingStatus !== 'ungraded_missing_keys')
      .map((r) => r.grade!.finalScore);

    const highest =
      gradedScores.length > 0 ? Math.max(...gradedScores) : null;
    const lowest =
      gradedScores.length > 0 ? Math.min(...gradedScores) : null;
    const average =
      gradedScores.length > 0
        ? gradedScores.reduce((acc, v) => acc + v, 0) / gradedScores.length
        : null;

    return {
      totalStudents: filteredRoster.length,
      participatedCount: participated.length,
      notParticipatedCount: notParticipated.length,
      highest,
      lowest,
      average,
    };
  }, [filteredRoster]);

  const handleDownloadCsv = () => {
    if (!selectedExam) return;
    const headers = [
      'No',
      'Nama Siswa',
      'Nomor Peserta',
      'Kelas',
      'Nama Ujian',
      'Waktu Mulai',
      'Waktu Selesai',
      'Jumlah Soal',
      'Jumlah Dijawab',
      'Jumlah Benar',
      'Jumlah Salah',
      'Jumlah Kosong',
      'Skor Mentah',
      'Nilai Akhir',
      'Status Ujian',
    ];

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [headers.join(',')];
    filteredRoster.forEach((r, idx) => {
      const att = r.attempt;
      const g = r.grade;
      const statusLabel = !att
        ? 'Belum Mengerjakan'
        : att.status === 'in_progress'
        ? 'Sedang Mengerjakan'
        : g?.gradingStatus === 'ungraded_missing_keys'
        ? 'Selesai (Kunci Belum Diverifikasi)'
        : g?.gradingStatus === 'graded_partial'
        ? 'Dinilai Parsial'
        : 'Selesai Dinilai';

      const rowVals = [
        idx + 1,
        r.fullName,
        r.participantNumber,
        r.className,
        selectedExam.title,
        att ? formatDateTime(att.startedAt) : '-',
        att && att.status !== 'in_progress' ? formatDateTime(att.submittedAt) : '-',
        selectedExam.questionCount,
        att ? att.answeredCount : 0,
        g && g.gradingStatus !== 'ungraded_missing_keys' ? g.correctCount : '-',
        g && g.gradingStatus !== 'ungraded_missing_keys' ? g.wrongCount : '-',
        att ? att.unansweredCount : selectedExam.questionCount,
        g && g.gradingStatus !== 'ungraded_missing_keys'
          ? `${g.rawScore}/${g.maxScore}`
          : '-',
        g && g.gradingStatus !== 'ungraded_missing_keys'
          ? g.finalScore.toFixed(2)
          : 'BELUM SIAP DINILAI',
        statusLabel,
      ];
      lines.push(rowVals.map(escapeCsv).join(','));
    });

    // Prepend UTF-8 BOM so Microsoft Excel in Indonesian schools opens columns cleanly
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Rekap_Nilai_${selectedExam.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Shared Exam Selector Header
  const ExamSelectorBar = (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 no-print">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
        <div className="min-w-[240px]">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Paket Ujian
          </label>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="w-full px-3 py-2 text-sm font-medium border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {exams.length === 0 && <option value="">Belum ada ujian dibuat</option>}
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.title} ({ex.subject} · {ex.questionCount} Soal)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Filter Kelas
          </label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="ALL">Semua Kelas</option>
            {availableClasses.map((cls) => (
              <option key={cls} value={cls}>
                Kelas {cls}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Pencarian Siswa
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau nomor peserta..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </div>

      {(activeSubTab === 'score_recap' || activeSubTab === 'export_reports') && (
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Urutkan Berdasarkan
          </label>
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'name_asc' | 'score_desc' | 'score_asc')
            }
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="score_desc">Nilai Tertinggi ke Terendah</option>
            <option value="score_asc">Nilai Terendah ke Tertinggi</option>
            <option value="name_asc">Nama Siswa (A - Z)</option>
          </select>
        </div>
      )}
    </div>
  );

  const UnverifiedKeysBanner =
    selectedExam && unverifiedKeyQuestions.length > 0 ? (
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 no-print">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-950">
          <div className="font-semibold">
            Peringatan Penilaian: {unverifiedKeyQuestions.length} dari {examQuestions.length} soal belum memiliki kunci jawaban terverifikasi (BELUM SIAP DINILAI PENUH).
          </div>
          <p className="text-xs text-amber-800 mt-1">
            Sistem tidak pernah menebak kunci jawaban secara otomatis. Buka menu <strong>Kunci Jawaban</strong> untuk memverifikasi kunci nomor:{' '}
            <span className="font-mono-tabular font-semibold">
              {unverifiedKeyQuestions.map((q) => q.originalNumber).join(', ')}
            </span>
            .
          </p>
        </div>
      </div>
    ) : null;

  // ============================================================================
  // MENU 9: DAFTAR PESERTA UJIAN (LIVE MONITORING)
  // ============================================================================
  if (activeSubTab === 'participants') {
    const activeCount = filteredRoster.filter(
      (r) => r.attempt?.status === 'in_progress'
    ).length;
    const submittedCount = filteredRoster.filter(
      (r) => r.attempt && r.attempt.status !== 'in_progress'
    ).length;
    const notStartedCount = filteredRoster.filter((r) => !r.attempt).length;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Daftar &amp; Pemantauan Peserta Ujian
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Pantau kehadiran peserta secara langsung: siapa yang sedang mengerjakan, telah mengumpulkan, atau belum memulai ujian.
          </p>
        </div>

        {ExamSelectorBar}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Sedang Mengerjakan
            </div>
            <div className="text-2xl font-bold text-blue-700 font-mono-tabular mt-1">
              {activeCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Sudah Mengumpulkan
            </div>
            <div className="text-2xl font-bold text-emerald-700 font-mono-tabular mt-1">
              {submittedCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Belum Mengerjakan
            </div>
            <div className="text-2xl font-bold text-slate-800 font-mono-tabular mt-1">
              {notStartedCount}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">No</th>
                  <th className="py-3 px-4">Nama Peserta</th>
                  <th className="py-3 px-4">Nomor Peserta</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4">Waktu Mulai</th>
                  <th className="py-3 px-4">Waktu Selesai</th>
                  <th className="py-3 px-4">Progres Jawaban</th>
                  <th className="py-3 px-4">Status Pengerjaan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredRoster.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 px-4 text-center text-slate-500">
                      Belum ada data peserta untuk filter ujian dan kelas ini.
                    </td>
                  </tr>
                ) : (
                  filteredRoster.map((row, idx) => {
                    const att = row.attempt;
                    return (
                      <tr key={row.studentKey} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono-tabular text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {row.fullName}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700">
                          {row.participantNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{row.className}</td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600">
                          {att ? formatDateTime(att.startedAt) : '-'}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600">
                          {att && att.status !== 'in_progress'
                            ? formatDateTime(att.submittedAt)
                            : '-'}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-800">
                          {att ? (
                            <span>
                              {att.answeredCount}/{att.totalQuestions} dijawab
                              {att.flaggedCount > 0 ? ` · ${att.flaggedCount} ragu` : ''}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {!att ? (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                              Belum Mengerjakan
                            </span>
                          ) : att.status === 'in_progress' ? (
                            <span className="inline-flex px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded">
                              Sedang Mengerjakan
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              {att.status === 'expired_submitted'
                                ? 'Selesai (Waktu Habis)'
                                : 'Selesai Dikumpulkan'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MENU 10: HASIL UJIAN & KOREKSI OTOMATIS
  // ============================================================================
  if (activeSubTab === 'exam_results') {
    const gradedCount = examAttempts.filter((a) => gradesByAttemptId.has(a.id)).length;
    const publishedCount = examAttempts.filter((a) => a.scorePublished).length;

    return (
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Hasil Ujian &amp; Koreksi Otomatis
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Hitung nilai berdasarkan kunci jawaban yang telah diverifikasi, periksa rincian lembar jawaban siswa, dan atur publikasi nilai.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!selectedExam || gradingBusy}
              onClick={handleRunAutoGrading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${gradingBusy ? 'animate-spin' : ''}`} />
              {gradingBusy
                ? 'Menilai Lembar Jawaban...'
                : 'Jalankan / Perbarui Koreksi Otomatis'}
            </button>

            <button
              type="button"
              disabled={!selectedExam || gradedCount === 0 || publishBusy}
              onClick={() => setConfirmPublishModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              Publikasikan Nilai ({publishedCount}/{examAttempts.length})
            </button>

            {publishedCount > 0 && (
              <button
                type="button"
                disabled={publishBusy}
                onClick={() => handlePublishScores(false)}
                className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Tarik Publikasi
              </button>
            )}
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-lg border text-sm flex items-center justify-between gap-4 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs font-medium underline whitespace-nowrap shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {UnverifiedKeysBanner}
        {ExamSelectorBar}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Peserta</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4">Status Sesi</th>
                  <th className="py-3 px-4">Benar · Salah · Kosong</th>
                  <th className="py-3 px-4">Skor Mentah</th>
                  <th className="py-3 px-4">Nilai Akhir</th>
                  <th className="py-3 px-4">Status Penilaian</th>
                  <th className="py-3 px-4 text-right">Lembar Jawaban</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {examAttempts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 px-4 text-center text-slate-500">
                      Belum ada lembar jawaban yang masuk untuk ujian ini.
                    </td>
                  </tr>
                ) : (
                  examAttempts.map((att) => {
                    const g = gradesByAttemptId.get(att.id);
                    return (
                      <tr key={att.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {att.studentName}
                          </div>
                          <div className="text-xs text-slate-500 font-mono-tabular">
                            {att.participantNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700">{att.className}</td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          {att.status === 'in_progress'
                            ? 'Sedang Mengerjakan'
                            : 'Selesai Dikumpulkan'}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-800">
                          {g && g.gradingStatus !== 'ungraded_missing_keys'
                            ? `${g.correctCount} · ${g.wrongCount} · ${g.unansweredCount}`
                            : `- · - · ${att.unansweredCount}`}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-800">
                          {g && g.gradingStatus !== 'ungraded_missing_keys'
                            ? `${g.rawScore} / ${g.maxScore}`
                            : '-'}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular font-bold text-slate-900">
                          {g && g.gradingStatus !== 'ungraded_missing_keys'
                            ? g.finalScore.toFixed(2)
                            : '-'}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {!g ? (
                            <span className="text-slate-500">Belum Dikoreksi</span>
                          ) : g.gradingStatus === 'ungraded_missing_keys' ? (
                            <span className="font-semibold text-amber-800">
                              BELUM SIAP DINILAI
                            </span>
                          ) : g.gradingStatus === 'graded_partial' ? (
                            <span className="font-semibold text-amber-800">
                              Parsial ({g.unverifiedKeyCount} kunci kosong)
                              {att.scorePublished ? ' · Terpublikasi' : ''}
                            </span>
                          ) : (
                            <span className="font-semibold text-emerald-700">
                              Lengkap{att.scorePublished ? ' · Terpublikasi' : ' · Privat'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openInspectModal(att)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Rincian Jawaban
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Confirm Publish Modal */}
        {confirmPublishModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Publikasikan Nilai Ujian ke Siswa?
              </h3>
              {unverifiedKeyQuestions.length > 0 ? (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>Perhatian:</strong> Masih terdapat{' '}
                  {unverifiedKeyQuestions.length} soal yang kunci jawabannya belum diverifikasi. Nilai yang dipublikasikan saat ini hanya menghitung soal yang kuncinya telah diverifikasi.
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Seluruh kunci jawaban ujian ini telah diverifikasi. Siswa akan dapat melihat nilai akhir pada halaman riwayat ujian mereka.
                </p>
              )}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmPublishModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={publishBusy}
                  onClick={() => handlePublishScores(true)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {publishBusy ? 'Mempublikasikan...' : 'Ya, Publikasikan Nilai'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Per-Student Answer Breakdown Modal */}
        {inspectAttempt && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-4xl w-full max-h-[88vh] flex flex-col shadow-xl">
              <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Lembar Jawaban Peserta — {inspectAttempt.studentName}
                  </h3>
                  <p className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                    Nomor Peserta: {inspectAttempt.participantNumber} · Kelas{' '}
                    {inspectAttempt.className} · {inspectAttempt.examTitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectAttempt(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {inspectLoading ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    Memuat rincian jawaban siswa...
                  </div>
                ) : inspectBreakdown ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-xs text-slate-500">Benar Penuh</div>
                        <div className="text-lg font-bold font-mono-tabular text-emerald-700">
                          {inspectBreakdown.correctCount}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-xs text-slate-500">Salah</div>
                        <div className="text-lg font-bold font-mono-tabular text-red-700">
                          {inspectBreakdown.wrongCount}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-xs text-slate-500">Skor Mentah</div>
                        <div className="text-lg font-bold font-mono-tabular text-slate-900">
                          {inspectBreakdown.rawScore} / {inspectBreakdown.maxScore}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-xs text-slate-500">Nilai Akhir</div>
                        <div className="text-lg font-bold font-mono-tabular text-blue-700">
                          {inspectBreakdown.gradingStatus === 'ungraded_missing_keys'
                            ? 'BELUM SIAP'
                            : inspectBreakdown.finalScore.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                            <th className="py-2.5 px-3">No</th>
                            <th className="py-2.5 px-3">Cuplikan Soal</th>
                            <th className="py-2.5 px-3">Jawaban Siswa</th>
                            <th className="py-2.5 px-3">Kunci Terverifikasi</th>
                            <th className="py-2.5 px-3 text-right">Skor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {examQuestions.map((q) => {
                            const detail = inspectBreakdown.details.find(
                              (d) => d.questionId === q.id
                            );
                            const resp = inspectResponses[q.id];
                            const key = answerKeysByQuestionId[q.id];
                            return (
                              <tr key={q.id}>
                                <td className="py-2.5 px-3 font-mono-tabular font-semibold text-slate-800">
                                  {q.originalNumber}
                                </td>
                                <td className="py-2.5 px-3 text-slate-700 max-w-xs truncate">
                                  <MathText text={q.stemText.slice(0, 90) + '...'} />
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular text-slate-900">
                                  {formatStudentResponseText(q, resp)}
                                </td>
                                <td className="py-2.5 px-3 font-mono-tabular text-slate-700">
                                  {formatVerifiedKeyText(q, key)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold">
                                  {detail?.outcome === 'unverified_key' ? (
                                    <span className="text-amber-700">Belum Diverifikasi</span>
                                  ) : (
                                    <span
                                      className={
                                        detail?.outcome === 'correct'
                                          ? 'text-emerald-700'
                                          : detail?.outcome === 'partial'
                                          ? 'text-blue-700'
                                          : 'text-slate-600'
                                      }
                                    >
                                      {detail?.earnedScore ?? 0} / {detail?.maxWeight ?? 1}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="p-4 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInspectAttempt(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // MENU 11 (REKAP NILAI SISWA) & MENU 12 (EKSPOR DAN CETAK LAPORAN)
  // ============================================================================
  const isExportTab = activeSubTab === 'export_reports';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 no-print">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isExportTab
              ? 'Ekspor CSV & Cetak Laporan Resmi Sekolah'
              : 'Rekapitulasi Nilai Siswa'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {isExportTab
              ? 'Unduh rekapitulasi nilai dalam format CSV (kompatibel Microsoft Excel) atau cetak daftar nilai resmi administrasi sekolah.'
              : 'Tabel lengkap 15 kolom rekapitulasi nilai seluruh siswa beserta statistik pencapaian kelas.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={!selectedExam}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-slate-600" />
            Unduh CSV (Excel)
          </button>
          {isExportTab && (
            <button
              type="button"
              disabled={!selectedExam}
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              Cetak Laporan Nilai
            </button>
          )}
        </div>
      </div>

      {UnverifiedKeysBanner}
      {ExamSelectorBar}

      {/* Summary Statistics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 no-print">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Nilai Tertinggi</div>
          <div className="text-xl font-bold font-mono-tabular text-emerald-700 mt-1">
            {recapMetrics.highest !== null ? recapMetrics.highest.toFixed(2) : '-'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Nilai Terendah</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-800 mt-1">
            {recapMetrics.lowest !== null ? recapMetrics.lowest.toFixed(2) : '-'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Rata-Rata Kelas</div>
          <div className="text-xl font-bold font-mono-tabular text-blue-700 mt-1">
            {recapMetrics.average !== null ? recapMetrics.average.toFixed(2) : '-'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Sudah Mengikuti</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-1">
            {recapMetrics.participatedCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Belum Mengikuti</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-600 mt-1">
            {recapMetrics.notParticipatedCount}
          </div>
        </div>
      </div>

      {/* Printable Report Container */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 print-container">
        {/* Formal School Report Header (always visible in Export tab & when printing) */}
        <div
          className={`${
            isExportTab ? 'block' : 'print-only'
          } pb-4 mb-4 border-b-2 border-slate-900`}
        >
          <div className="text-center space-y-1">
            <div className="text-sm font-bold uppercase tracking-wider text-slate-700">
              DAFTAR REKAPITULASI HASIL SIMULASI TES KEMAMPUAN AKADEMIK (TKA) SD
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              {selectedExam ? selectedExam.title : 'SIMULASI TKA SD — CBT ONLINE'}
            </h3>
            <p className="text-xs text-slate-600 font-mono-tabular">
              Mata Pelajaran: {selectedExam?.subject || 'Matematika'} · Kelas:{' '}
              {classFilter === 'ALL' ? 'Semua Kelas' : classFilter} · Jumlah Soal:{' '}
              {selectedExam?.questionCount || 0} Butir · Dicetak:{' '}
              {new Date().toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>

        {/* Full 15-Column Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-300 font-semibold text-slate-700">
                <th className="py-2.5 px-2.5">No</th>
                <th className="py-2.5 px-2.5">Nama Siswa</th>
                <th className="py-2.5 px-2.5">Nomor Peserta</th>
                <th className="py-2.5 px-2.5">Kelas</th>
                <th className="py-2.5 px-2.5">Nama Ujian</th>
                <th className="py-2.5 px-2.5">Waktu Mulai</th>
                <th className="py-2.5 px-2.5">Waktu Selesai</th>
                <th className="py-2.5 px-2.5 text-right">Jml Soal</th>
                <th className="py-2.5 px-2.5 text-right">Dijawab</th>
                <th className="py-2.5 px-2.5 text-right">Benar</th>
                <th className="py-2.5 px-2.5 text-right">Salah</th>
                <th className="py-2.5 px-2.5 text-right">Kosong</th>
                <th className="py-2.5 px-2.5 text-right">Skor Mentah</th>
                <th className="py-2.5 px-2.5 text-right">Nilai Akhir</th>
                <th className="py-2.5 px-2.5">Status Ujian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRoster.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-10 px-4 text-center text-slate-500">
                    Tidak ada data rekapitulasi siswa untuk ditampilkan.
                  </td>
                </tr>
              ) : (
                filteredRoster.map((r, idx) => {
                  const att = r.attempt;
                  const g = r.grade;
                  const ready = g && g.gradingStatus !== 'ungraded_missing_keys';

                  return (
                    <tr key={r.studentKey} className="hover:bg-slate-50/70">
                      <td className="py-2 px-2.5 font-mono-tabular text-slate-600">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2.5 font-semibold text-slate-900">
                        {r.fullName}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-slate-700">
                        {r.participantNumber}
                      </td>
                      <td className="py-2 px-2.5 text-slate-700">{r.className}</td>
                      <td className="py-2 px-2.5 text-slate-700">
                        {selectedExam?.title || '-'}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-slate-600 whitespace-nowrap">
                        {att ? formatDateTime(att.startedAt) : '-'}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-slate-600 whitespace-nowrap">
                        {att && att.status !== 'in_progress'
                          ? formatDateTime(att.submittedAt)
                          : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-slate-700">
                        {selectedExam?.questionCount ?? 0}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-slate-800">
                        {att ? att.answeredCount : 0}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-emerald-700 font-medium">
                        {ready ? g!.correctCount : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-red-700 font-medium">
                        {ready ? g!.wrongCount : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-slate-600">
                        {att ? att.unansweredCount : selectedExam?.questionCount ?? 0}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular text-slate-800">
                        {ready ? `${g!.rawScore}/${g!.maxScore}` : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-tabular font-bold text-slate-900">
                        {ready ? g!.finalScore.toFixed(2) : 'BELUM SIAP'}
                      </td>
                      <td className="py-2 px-2.5 text-slate-700 whitespace-nowrap">
                        {!att
                          ? 'Belum Mengerjakan'
                          : att.status === 'in_progress'
                          ? 'Sedang Mengerjakan'
                          : g?.gradingStatus === 'graded_partial'
                          ? 'Selesai (Parsial)'
                          : ready
                          ? 'Selesai Dinilai'
                          : 'Kunci Belum Siap'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Signature Block on Print / Export Tab */}
        <div
          className={`${
            isExportTab ? 'flex' : 'print-only'
          } justify-between items-start mt-8 pt-4 text-xs text-slate-800`}
        >
          <div>
            <div>Rekapitulasi Statistik:</div>
            <div className="font-mono-tabular mt-1">
              Peserta Hadir: {recapMetrics.participatedCount} · Belum Mengikuti:{' '}
              {recapMetrics.notParticipatedCount} · Rata-rata:{' '}
              {recapMetrics.average !== null ? recapMetrics.average.toFixed(2) : '-'}
            </div>
          </div>
          <div className="text-center min-w-[200px]">
            <div>Mengetahui,</div>
            <div className="font-semibold">Guru Kelas VI / Pengawas Ujian</div>
            <div className="h-16" />
            <div className="border-t border-slate-400 pt-1 font-medium">
              ( ........................................ )
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
