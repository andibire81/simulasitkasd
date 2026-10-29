import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileSpreadsheet,
  FileText,
  FileUp,
  Image as ImageIcon,
  Key,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Printer,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  recordAuditLog,
  syncPublishedExamsPortalIndex,
} from '../lib/firebase';
import {
  AdminRecord,
  AnswerKeyRecord,
  AssetRecord,
  AttemptRecord,
  AuditLogRecord,
  CbtPortalRecord,
  CbtTokenRecord,
  clampStr,
  ExamGradeRecord,
  ExamRecord,
  ExamStatus,
  normalizeSchoolName,
  QuestionRecord,
  ResponseRecord,
  sanitizeId,
  StudentDirectoryRecord,
  UserProfile,
  VerificationStatus,
} from '../types/cbt';
import { evaluateAttemptGrades } from '../lib/gradingEngine';
import { TO1_PACK_ID, TO1_SOURCE_PDF_NAME } from '../data/to1MtkSource';
import { BINDO2_PACK_ID, BINDO2_SOURCE_PDF_NAME } from '../data/bindo2Source';
import {
  syncTo1QuestionsAndAnswerKeysToFirestore,
  TO1_MTK_ANSWER_KEYS,
} from '../data/to1MtkAnswerKeys';
import {
  BINDO2_ANSWER_KEYS,
  syncBindo2QuestionsAndAnswerKeysToFirestore,
} from '../data/bindo2AnswerKeys';
import { AdminPdfAndVerification } from './admin/AdminPdfAndVerification';
import { AdminAnswerKeysAndExams } from './admin/AdminAnswerKeysAndExams';
import { AdminStudentsAndAccess } from './admin/AdminStudentsAndAccess';
import { AdminResultsAndReports } from './admin/AdminResultsAndReports';
import { TokenManagerCard } from './admin/TokenManagerCard';
import { AppFooter } from './AppFooter';

export type AdminMenuId =
  | 'overview'
  | 'students'
  | 'pdf_import'
  | 'question_bank'
  | 'verify_questions'
  | 'verify_images'
  | 'answer_keys'
  | 'exam_settings'
  | 'participants'
  | 'exam_results'
  | 'score_recap'
  | 'export_reports'
  | 'access_settings'
  | 'audit_logs';

interface AdminDashboardProps {
  onOpenStudentPreview: () => void;
}

interface NavGroup {
  label: string;
  items: Array<{
    id: AdminMenuId;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeCount?: number;
  }>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onOpenStudentPreview,
}) => {
  const {
    isAdmin,
    isSuperAdmin,
    firebaseUser,
    profile,
    adminRecord,
    registrationSettings,
    signOut,
  } = useAuth();
  const [activeMenu, setActiveMenu] = useState<AdminMenuId>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState<string>('ALL');
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [quickSetupBusy, setQuickSetupBusy] = useState(false);
  const [quickSetupMessage, setQuickSetupMessage] = useState<string | null>(null);

  const adminSchoolName = (
    adminRecord?.schoolName ||
    profile?.schoolName ||
    'Penyelenggara TKA SD'
  ).trim();

  // Real-time Firestore state
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [studentDirectory, setStudentDirectory] = useState<StudentDirectoryRecord[]>([]);
  const [cbtTokens, setCbtTokens] = useState<CbtTokenRecord[]>([]);
  const [portalExamIds, setPortalExamIds] = useState<string[] | null>(null);
  const [examsLoaded, setExamsLoaded] = useState(false);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [attemptsLoaded, setAttemptsLoaded] = useState(false);
  const [gradesLoaded, setGradesLoaded] = useState(false);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [answerKeys, setAnswerKeys] = useState<AnswerKeyRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [examGrades, setExamGrades] = useState<ExamGradeRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  const autoSeededTo1Ref = useRef(false);
  const autoGradingInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAdmin) return;

    const unsubs = [
      onSnapshot(
        collection(db, 'users'),
        (snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'users')
      ),
      onSnapshot(
        collection(db, 'studentDirectory'),
        (snap) =>
          setStudentDirectory(
            snap.docs.map((d) => d.data() as StudentDirectoryRecord)
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'studentDirectory')
      ),
      onSnapshot(
        collection(db, 'cbtTokens'),
        (snap) => setCbtTokens(snap.docs.map((d) => d.data() as CbtTokenRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'cbtTokens')
      ),
      onSnapshot(
        doc(db, 'cbtPortal', 'publishedExams'),
        (snap) => {
          if (snap.exists()) {
            const p = snap.data() as CbtPortalRecord;
            setPortalExamIds(p.examIds || []);
          } else {
            setPortalExamIds([]);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'cbtPortal/publishedExams')
      ),
      onSnapshot(
        collection(db, 'admins'),
        (snap) => setAdmins(snap.docs.map((d) => d.data() as AdminRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'admins')
      ),
      onSnapshot(
        collection(db, 'questions'),
        (snap) => {
          setQuestions(snap.docs.map((d) => d.data() as QuestionRecord));
          setQuestionsLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'questions')
      ),
      onSnapshot(
        collection(db, 'answerKeys'),
        (snap) => {
          setAnswerKeys(snap.docs.map((d) => d.data() as AnswerKeyRecord));
          setKeysLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'answerKeys')
      ),
      onSnapshot(
        collection(db, 'exams'),
        (snap) => {
          setExams(snap.docs.map((d) => d.data() as ExamRecord));
          setExamsLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'exams')
      ),
      onSnapshot(
        collection(db, 'attempts'),
        (snap) => {
          setAttempts(snap.docs.map((d) => d.data() as AttemptRecord));
          setAttemptsLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'attempts')
      ),
      onSnapshot(
        collection(db, 'examGrades'),
        (snap) => {
          setExamGrades(snap.docs.map((d) => d.data() as ExamGradeRecord));
          setGradesLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'examGrades')
      ),
      onSnapshot(
        collection(db, 'assets'),
        (snap) => {
          setAssets(snap.docs.map((d) => d.data() as AssetRecord));
          setAssetsLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'assets')
      ),
      onSnapshot(
        collection(db, 'auditLogs'),
        (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLogRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
      ),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isAdmin]);

  // Automatically store & verify all 60 questions (30 Matematika TO 1 MTK + 30 Bahasa Indonesia B.Indo 2) + AI-analyzed answer keys on initial Admin load
  useEffect(() => {
    if (
      !isAdmin ||
      autoSeededTo1Ref.current ||
      !questionsLoaded ||
      !assetsLoaded ||
      !keysLoaded ||
      !examsLoaded
    ) {
      return;
    }

    const existingQMap = new Map(questions.map((q) => [q.id, q]));
    const existingKMap = new Map(answerKeys.map((k) => [k.questionId, k]));

    const needsAutoSeedTo1 = TO1_MTK_ANSWER_KEYS.some((seed) => {
      const q = existingQMap.get(seed.questionId);
      const k = existingKMap.get(seed.questionId);
      if (isSuperAdmin) {
        return (
          !q ||
          q.verificationStatus !== VerificationStatus.VERIFIED ||
          !q.answerKeyVerified ||
          !k ||
          !k.verified ||
          !k.discussion
        );
      }
      return (
        !q ||
        q.verificationStatus !== VerificationStatus.VERIFIED ||
        !k ||
        !k.verified
      );
    });

    const needsAutoSeedBindo2 = BINDO2_ANSWER_KEYS.some((seed) => {
      const q = existingQMap.get(seed.questionId);
      const k = existingKMap.get(seed.questionId);
      if (isSuperAdmin) {
        return (
          !q ||
          q.verificationStatus !== VerificationStatus.VERIFIED ||
          !q.answerKeyVerified ||
          !k ||
          !k.verified ||
          !k.discussion
        );
      }
      return (
        !q ||
        q.verificationStatus !== VerificationStatus.VERIFIED ||
        !k ||
        !k.verified
      );
    });

    autoSeededTo1Ref.current = true;
    if (!needsAutoSeedTo1 && !needsAutoSeedBindo2) return;

    (async () => {
      if (needsAutoSeedTo1) {
        await syncTo1QuestionsAndAnswerKeysToFirestore({
          existingQuestions: questions,
          existingAssets: assets,
          existingAnswerKeys: answerKeys,
          exams,
          logSummaryPrefix: 'Menyinkronkan otomatis',
        });
      }
      if (needsAutoSeedBindo2) {
        await syncBindo2QuestionsAndAnswerKeysToFirestore({
          existingQuestions: questions,
          existingAssets: assets,
          existingAnswerKeys: answerKeys,
          exams,
          logSummaryPrefix: 'Menyinkronkan otomatis',
        });
      }
    })().catch((err) => console.warn('Auto-sync TKA SD AI keys warning:', err));
  }, [
    isAdmin,
    isSuperAdmin,
    questionsLoaded,
    assetsLoaded,
    keysLoaded,
    examsLoaded,
    questions,
    assets,
    answerKeys,
    exams,
  ]);

  // Automatically grade any submitted student attempt as soon as verified answer keys exist
  useEffect(() => {
    if (
      !isAdmin ||
      !questionsLoaded ||
      !keysLoaded ||
      !examsLoaded ||
      !attemptsLoaded ||
      !gradesLoaded
    ) {
      return;
    }

    const examById = new Map(exams.map((ex) => [ex.id, ex]));
    const qById = new Map(questions.map((q) => [q.id, q]));
    const keysByQId: Record<string, AnswerKeyRecord | undefined> = {};
    for (const k of answerKeys) {
      keysByQId[k.questionId] = k;
    }
    const gradesByAttemptId = new Map(examGrades.map((g) => [g.attemptId, g]));

    const pendingSubmittedAttempts = attempts.filter((att) => {
      if (att.status !== 'submitted' && att.status !== 'expired_submitted') return false;
      if (autoGradingInFlightRef.current.has(att.id)) return false;
      const ex = examById.get(att.examId);
      if (!ex || ex.questionIds.length === 0) return false;
      const allVerified = ex.questionIds.every((qid) => Boolean(keysByQId[qid]?.verified));
      if (!allVerified) return false;
      const existingGrade = gradesByAttemptId.get(att.id);
      return !existingGrade || existingGrade.gradingStatus !== 'graded_complete';
    });

    if (pendingSubmittedAttempts.length === 0) return;

    const graderEmail = auth.currentUser?.email || 'ai-auto-grader';

    pendingSubmittedAttempts.forEach((att) => {
      autoGradingInFlightRef.current.add(att.id);
      (async () => {
        try {
          const ex = examById.get(att.examId);
          if (!ex) return;
          const exQuestions = ex.questionIds
            .map((qid) => qById.get(qid))
            .filter((q): q is QuestionRecord => Boolean(q));

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
            questions: exQuestions,
            responsesByQuestionId,
            answerKeysByQuestionId: keysByQId,
          });

          const existingGrade = gradesByAttemptId.get(att.id);
          const gradeRef = doc(db, 'examGrades', att.id);
          if (existingGrade) {
            await updateDoc(gradeRef, {
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
            await setDoc(gradeRef, {
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

          if (ex.publishScore && !att.scorePublished && evaluation.gradingStatus === 'graded_complete') {
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
        } catch (err) {
          console.warn('Auto-grading attempt warning:', err);
          autoGradingInFlightRef.current.delete(att.id);
        }
      })();
    });
  }, [
    isAdmin,
    questionsLoaded,
    keysLoaded,
    examsLoaded,
    attemptsLoaded,
    gradesLoaded,
    exams,
    questions,
    answerKeys,
    attempts,
    examGrades,
  ]);

  // Keep /cbtPortal/publishedExams synchronized automatically if out of sync
  useEffect(() => {
    if (!isAdmin || !examsLoaded || portalExamIds === null) return;
    const expectedIds = exams
      .filter(
        (ex) =>
          ex.status === ExamStatus.WAITING ||
          ex.status === ExamStatus.ACTIVE ||
          ex.status === ExamStatus.FINISHED
      )
      .map((ex) => ex.id)
      .slice(0, 500);

    const same =
      expectedIds.length === portalExamIds.length &&
      expectedIds.every((id, i) => portalExamIds[i] === id);

    if (!same) {
      syncPublishedExamsPortalIndex(exams).catch((err) =>
        console.warn('Portal index sync warning:', err)
      );
    }
  }, [isAdmin, examsLoaded, exams, portalExamIds]);

  // Distinct registered schools across Admins, Students & Exams
  const availableSchools = useMemo(() => {
    const byNorm = new Map<string, string>();
    const register = (raw?: string) => {
      const trimmed = (raw || '').trim();
      if (!trimmed || trimmed === 'Semua' || trimmed === 'Penyelenggara TKA SD') return;
      const norm = normalizeSchoolName(trimmed);
      if (norm && !byNorm.has(norm)) {
        byNorm.set(norm, trimmed);
      }
    };
    admins.forEach((a) => register(a.schoolName));
    studentDirectory.forEach((s) => register(s.schoolName));
    exams.forEach((ex) => register(ex.schoolName));
    return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b, 'id'));
  }, [admins, studentDirectory, exams]);

  const effectiveSchool = isSuperAdmin ? selectedSchoolFilter : adminSchoolName;

  // Multi-school scoped datasets
  const scopedStudents = useMemo(() => {
    if (isSuperAdmin && effectiveSchool === 'ALL') return studentDirectory;
    const targetNorm = normalizeSchoolName(effectiveSchool);
    return studentDirectory.filter(
      (s) => normalizeSchoolName(s.schoolName) === targetNorm
    );
  }, [isSuperAdmin, effectiveSchool, studentDirectory]);

  const scopedExams = useMemo(() => {
    if (isSuperAdmin && effectiveSchool === 'ALL') return exams;
    const targetNorm = normalizeSchoolName(effectiveSchool);
    return exams.filter(
      (ex) =>
        !ex.schoolName ||
        ex.schoolName === 'Semua' ||
        normalizeSchoolName(ex.schoolName) === targetNorm
    );
  }, [isSuperAdmin, effectiveSchool, exams]);

  const scopedAttempts = useMemo(() => {
    if (isSuperAdmin && effectiveSchool === 'ALL') return attempts;
    const targetNorm = normalizeSchoolName(effectiveSchool);
    return attempts.filter(
      (att) => normalizeSchoolName(att.schoolName) === targetNorm
    );
  }, [isSuperAdmin, effectiveSchool, attempts]);

  const scopedGrades = useMemo(() => {
    if (isSuperAdmin && effectiveSchool === 'ALL') return examGrades;
    const attemptIds = new Set(scopedAttempts.map((a) => a.id));
    return examGrades.filter((g) => attemptIds.has(g.attemptId));
  }, [isSuperAdmin, effectiveSchool, scopedAttempts, examGrades]);

  const scopedAuditLogs = useMemo(() => {
    if (isSuperAdmin && effectiveSchool === 'ALL') return auditLogs;
    if (isSuperAdmin) {
      const targetNorm = normalizeSchoolName(effectiveSchool);
      const schoolAdminUids = new Set(
        admins
          .filter((a) => normalizeSchoolName(a.schoolName || '') === targetNorm)
          .map((a) => a.uid)
      );
      return auditLogs.filter(
        (l) =>
          schoolAdminUids.has(l.actorUid) ||
          normalizeSchoolName(l.summary).includes(targetNorm)
      );
    }
    const myEmail = (firebaseUser?.email || '').toLowerCase();
    return auditLogs.filter(
      (l) =>
        l.actorUid === firebaseUser?.uid ||
        (myEmail && l.actorEmail.toLowerCase() === myEmail)
    );
  }, [isSuperAdmin, effectiveSchool, auditLogs, admins, firebaseUser]);

  const pendingAdminCount = useMemo(
    () => admins.filter((a) => a.status === 'pending').length,
    [admins]
  );

  // Check whether the current school already has dedicated Exam schedules
  const schoolDedicatedExams = useMemo(() => {
    if (!effectiveSchool || effectiveSchool === 'ALL' || effectiveSchool === 'Penyelenggara TKA SD') {
      return exams;
    }
    const targetNorm = normalizeSchoolName(effectiveSchool);
    return exams.filter(
      (ex) => ex.schoolName && normalizeSchoolName(ex.schoolName) === targetNorm
    );
  }, [exams, effectiveSchool]);

  const handleCopyRegistrationLink = async () => {
    const url = `${window.location.origin}/?daftar=admin`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteLink(true);
      setTimeout(() => setCopiedInviteLink(false), 2500);
    } catch {
      // Fallback ignored safely
    }
  };

  const handleQuickCreateSchoolExams = async () => {
    const targetSchool =
      effectiveSchool && effectiveSchool !== 'ALL'
        ? effectiveSchool
        : adminSchoolName;
    if (!firebaseUser || !targetSchool || targetSchool === 'ALL') return;

    const mtkIds = questions
      .filter(
        (q) =>
          q.examPackId === TO1_PACK_ID &&
          q.verificationStatus === VerificationStatus.VERIFIED
      )
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((q) => q.id);

    const bindoIds = questions
      .filter(
        (q) =>
          q.examPackId === BINDO2_PACK_ID &&
          q.verificationStatus === VerificationStatus.VERIFIED
      )
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((q) => q.id);

    if (mtkIds.length === 0 && bindoIds.length === 0) {
      setQuickSetupMessage(
        'Bank soal sedang disinkronkan. Tunggu beberapa detik lalu klik kembali.'
      );
      return;
    }

    setQuickSetupBusy(true);
    setQuickSetupMessage(null);
    try {
      const schoolSlug = sanitizeId(normalizeSchoolName(targetSchool)).slice(0, 48) || 'sd';
      const now = new Date();
      const startTs = Timestamp.fromDate(new Date(now.getTime() - 5 * 60 * 1000));
      const endTs = Timestamp.fromDate(
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      );
      const createdExams: ExamRecord[] = [];
      const targetNorm = normalizeSchoolName(targetSchool);

      const hasMtk = exams.some(
        (ex) =>
          ex.examPackId === TO1_PACK_ID &&
          ex.schoolName &&
          normalizeSchoolName(ex.schoolName) === targetNorm
      );
      if (!hasMtk && mtkIds.length > 0) {
        const examId = sanitizeId(`exam_mtk_${schoolSlug}_${Date.now().toString(36)}`);
        const payload = {
          id: examId,
          title: clampStr(`Simulasi TKA Matematika — ${targetSchool}`, 200),
          description: clampStr(
            `Paket resmi 30 soal Matematika Kelas VI (${TO1_SOURCE_PDF_NAME}) khusus peserta ${targetSchool}.`,
            2000
          ),
          subject: 'Matematika',
          targetClass: 'Semua',
          examPackId: TO1_PACK_ID,
          questionIds: mtkIds,
          questionCount: mtkIds.length,
          durationMinutes: 90,
          scheduledStart: startTs,
          scheduledEnd: endTs,
          status: ExamStatus.ACTIVE,
          allowRetake: false,
          shuffleQuestions: false,
          shuffleOptions: false,
          showDiscussion: true,
          publishScore: true,
          sourcePdfName: TO1_SOURCE_PDF_NAME,
          schoolName: clampStr(targetSchool, 120),
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'exams', examId), payload);
        createdExams.push(payload as unknown as ExamRecord);
      }

      const hasBindo = exams.some(
        (ex) =>
          ex.examPackId === BINDO2_PACK_ID &&
          ex.schoolName &&
          normalizeSchoolName(ex.schoolName) === targetNorm
      );
      if (!hasBindo && bindoIds.length > 0) {
        const examId = sanitizeId(`exam_bindo_${schoolSlug}_${Date.now().toString(36)}`);
        const payload = {
          id: examId,
          title: clampStr(`Simulasi TKA Bahasa Indonesia — ${targetSchool}`, 200),
          description: clampStr(
            `Paket resmi 30 soal Bahasa Indonesia Kelas VI (${BINDO2_SOURCE_PDF_NAME}) khusus peserta ${targetSchool}.`,
            2000
          ),
          subject: 'Bahasa Indonesia',
          targetClass: 'Semua',
          examPackId: BINDO2_PACK_ID,
          questionIds: bindoIds,
          questionCount: bindoIds.length,
          durationMinutes: 90,
          scheduledStart: startTs,
          scheduledEnd: endTs,
          status: ExamStatus.ACTIVE,
          allowRetake: false,
          shuffleQuestions: false,
          shuffleOptions: false,
          showDiscussion: true,
          publishScore: true,
          sourcePdfName: BINDO2_SOURCE_PDF_NAME,
          schoolName: clampStr(targetSchool, 120),
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'exams', examId), payload);
        createdExams.push(payload as unknown as ExamRecord);
      }

      if (createdExams.length > 0) {
        await syncPublishedExamsPortalIndex([...exams, ...createdExams]);
        await recordAuditLog({
          action: 'QUICK_PROVISION_SCHOOL_EXAMS',
          targetType: 'exam',
          targetId: schoolSlug,
          summary: `Menyiapkan otomatis ${createdExams.length} paket ujian aktif untuk ${targetSchool}.`,
        });
        setQuickSetupMessage(
          `${createdExams.length} paket ujian resmi (Matematika & Bahasa Indonesia) telah aktif untuk ${targetSchool}.`
        );
      } else {
        setQuickSetupMessage(
          `Paket ujian untuk ${targetSchool} sudah tersedia di Pengaturan Ujian.`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'exams');
    } finally {
      setQuickSetupBusy(false);
    }
  };

  // Live Overview Metrics (scoped to active school view)
  const overviewStats = useMemo(() => {
    const totalStudents = scopedStudents.length;
    const totalExams = scopedExams.length;
    const activeExams = scopedExams.filter((e) => e.status === ExamStatus.ACTIVE).length;

    const participatedStudentKeys = new Set<string>();
    scopedAttempts.forEach((a) => participatedStudentKeys.add(a.studentUid));
    const participatedCount = participatedStudentKeys.size;
    const notParticipatedCount = Math.max(0, totalStudents - participatedCount);

    const validGrades = scopedGrades.filter(
      (g) => g.gradingStatus !== 'ungraded_missing_keys'
    );
    const avgScore =
      validGrades.length > 0
        ? validGrades.reduce((sum, g) => sum + g.finalScore, 0) / validGrades.length
        : null;

    const unverifiedQuestionsCount = questions.filter(
      (q) => q.verificationStatus !== VerificationStatus.VERIFIED
    ).length;

    const visualQuestions = questions.filter(
      (q) =>
        q.imageUrls.length > 0 ||
        q.secondaryImageUrls.length > 0 ||
        q.optionHasImages
    );
    const unverifiedImagesCount = visualQuestions.filter(
      (q) => !q.imageVerified
    ).length;

    const verifiedKeysCount = answerKeys.filter((k) => k.verified).length;
    const missingKeysCount = Math.max(0, questions.length - verifiedKeysCount);

    return {
      totalStudents,
      totalExams,
      activeExams,
      participatedCount,
      notParticipatedCount,
      avgScore,
      unverifiedQuestionsCount,
      unverifiedImagesCount,
      verifiedKeysCount,
      missingKeysCount,
    };
  }, [
    scopedStudents,
    scopedExams,
    scopedAttempts,
    scopedGrades,
    questions,
    answerKeys,
  ]);

  const navGroups: NavGroup[] = [
    {
      label: 'Utama',
      items: [
        { id: 'overview', title: '1. Ringkasan', icon: LayoutDashboard },
        { id: 'students', title: '2. Data Siswa', icon: Users },
      ],
    },
    {
      label: 'Bank Soal & PDF Asli',
      items: [
        { id: 'pdf_import', title: '3. Impor PDF', icon: FileUp },
        { id: 'question_bank', title: '4. Bank Soal', icon: BookOpen },
        {
          id: 'verify_questions',
          title: '5. Verifikasi Soal',
          icon: ClipboardCheck,
          badgeCount: overviewStats.unverifiedQuestionsCount,
        },
        {
          id: 'verify_images',
          title: '6. Verifikasi Gambar',
          icon: ImageIcon,
          badgeCount: overviewStats.unverifiedImagesCount,
        },
        {
          id: 'answer_keys',
          title: '7. Kunci Jawaban',
          icon: Key,
          badgeCount: overviewStats.missingKeysCount,
        },
      ],
    },
    {
      label: 'Pelaksanaan & Nilai',
      items: [
        { id: 'exam_settings', title: '8. Pengaturan Ujian', icon: Settings },
        { id: 'participants', title: '9. Daftar Peserta Ujian', icon: ListChecks },
        { id: 'exam_results', title: '10. Hasil Ujian', icon: CheckCircle2 },
        { id: 'score_recap', title: '11. Rekap Nilai', icon: FileSpreadsheet },
        { id: 'export_reports', title: '12. Ekspor Laporan', icon: Printer },
      ],
    },
    {
      label: 'Sistem & Keamanan',
      items: [
        {
          id: 'access_settings',
          title: '13. Akun & Hak Akses',
          icon: Shield,
          badgeCount: isSuperAdmin && pendingAdminCount > 0 ? pendingAdminCount : undefined,
        },
        { id: 'audit_logs', title: '14. Log Aktivitas', icon: FileText },
      ],
    },
  ];

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 text-red-700">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h1 className="text-lg font-bold">Akses Ditolak</h1>
          </div>
          <p className="text-sm text-slate-600">
            Halaman Dashboard Admin hanya dapat diakses oleh Guru / Pengawas yang terdaftar sebagai Administrator resmi.
          </p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onOpenStudentPreview}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Ke Beranda Siswa
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              Keluar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectMenu = (id: AdminMenuId) => {
    setActiveMenu(id);
    setMobileMenuOpen(false);
  };

  const registrationModeLabel =
    registrationSettings?.mode === 'approval'
      ? 'Persetujuan Manual'
      : registrationSettings?.mode === 'closed'
      ? 'Ditutup Sementara'
      : 'Terbuka Otomatis';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
            aria-label="Buka navigasi admin"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold tracking-tight text-slate-900 truncate">
              SIMULASI TKA SD — DASHBOARD ADMIN
            </div>
            <div className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5 truncate">
              <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="font-medium text-slate-700 truncate">
                {isSuperAdmin
                  ? effectiveSchool === 'ALL'
                    ? `Super Admin · Semua Sekolah (${availableSchools.length} SD)`
                    : `Filter Sekolah: ${effectiveSchool}`
                  : adminSchoolName}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isSuperAdmin && availableSchools.length > 0 && (
            <select
              aria-label="Filter Sekolah Dasar"
              value={selectedSchoolFilter}
              onChange={(e) => setSelectedSchoolFilter(e.target.value)}
              className="hidden xl:block max-w-56 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">
                Semua Sekolah ({availableSchools.length})
              </option>
              {availableSchools.map((sch) => (
                <option key={sch} value={sch}>
                  {sch}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onOpenStudentPreview}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
          >
            Lihat Portal Siswa
          </button>
          <div className="hidden md:block text-right">
            <div className="text-xs font-semibold text-slate-900">
              {isSuperAdmin ? 'Super Admin' : adminRecord?.position || 'Admin Sekolah'}
            </div>
            <div className="text-[11px] font-mono-tabular text-slate-500">
              {firebaseUser?.email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar Navigation (14 Required Admin Menus) */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-16 left-0 z-40 block' : 'hidden'
          } lg:static lg:block w-68 shrink-0 bg-white border-r border-slate-200 overflow-y-auto no-print`}
        >
          <nav className="p-4 space-y-5">
            {isSuperAdmin && availableSchools.length > 0 && (
              <div className="xl:hidden space-y-1.5 pb-3 border-b border-slate-100">
                <label className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Filter Sekolah
                </label>
                <select
                  value={selectedSchoolFilter}
                  onChange={(e) => setSelectedSchoolFilter(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="ALL">
                    Semua Sekolah ({availableSchools.length})
                  </option>
                  {availableSchools.map((sch) => (
                    <option key={sch} value={sch}>
                      {sch}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeMenu === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectMenu(item.id)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-800 font-semibold'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            active ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.title}</span>
                      </span>
                      {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                        <span className="font-mono-tabular text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 shrink-0">
                          {item.badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content Canvas */}
        <main className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {activeMenu === 'overview' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                      Ringkasan Sistem Ujian CBT
                    </h1>
                    <p className="text-sm text-slate-600 mt-1">
                      {isSuperAdmin && effectiveSchool === 'ALL'
                        ? 'Menampilkan data gabungan seluruh sekolah penyelenggara secara langsung dari Cloud Firestore.'
                        : `Ruang kerja penyelenggara: ${effectiveSchool} — data siswa, token, dan nilai terpisah rapi per sekolah.`}
                    </p>
                  </div>
                </div>

                {/* Multi-School Shareable Registration Banner for Super Admin */}
                {isSuperAdmin && (
                  <div className="bg-white border border-blue-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                          <Share2 className="w-3.5 h-3.5" />
                          Publikasi Multi-Sekolah
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          Mode: {registrationModeLabel}
                        </span>
                        <span className="text-xs font-mono-tabular text-slate-600">
                          {availableSchools.length} Sekolah Terdaftar
                          {pendingAdminCount > 0 ? ` · ${pendingAdminCount} Menunggu Persetujuan` : ''}
                        </span>
                      </div>
                      <h2 className="text-sm sm:text-base font-bold text-slate-900">
                        Undang Guru / Operator Sekolah Dasar Lain Mendaftar sebagai Admin
                      </h2>
                      <p className="text-xs text-slate-600">
                        Bagikan tautan pendaftaran khusus di bawah ini ke grup KKG atau Kepala Sekolah. Guru cukup login Google (<code className="font-mono text-slate-800">belajar.id</code> / Gmail) dan mengisi nama sekolahnya.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopyRegistrationLink}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {copiedInviteLink ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Link Tersalin
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Salin Link Daftar Admin
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveMenu('access_settings')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
                      >
                        Pengaturan &amp; Undangan WA
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* 1-Click School Onboarding Quick-Start for New School Admins */}
                {effectiveSchool !== 'ALL' &&
                  effectiveSchool !== 'Penyelenggara TKA SD' &&
                  schoolDedicatedExams.length < 2 && (
                    <div className="bg-white border border-emerald-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <Sparkles className="w-3.5 h-3.5" />
                          Siap Pakai untuk {effectiveSchool}
                        </div>
                        <h2 className="text-sm sm:text-base font-bold text-slate-900">
                          Aktifkan Paket Simulasi TKA Matematika &amp; Bahasa Indonesia untuk Sekolah Anda
                        </h2>
                        <p className="text-xs text-slate-600">
                          Satu klik menyiapkan 2 jadwal ujian aktif (30 soal Matematika + 30 soal Bahasa Indonesia berverifikasi AI) khusus untuk siswa <strong>{effectiveSchool}</strong>.
                        </p>
                        {quickSetupMessage && (
                          <p className="text-xs font-medium text-emerald-700 pt-1">
                            {quickSetupMessage}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          disabled={quickSetupBusy}
                          onClick={handleQuickCreateSchoolExams}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {quickSetupBusy
                            ? 'Menyiapkan Paket...'
                            : 'Aktifkan 2 Paket Ujian Sekolah Saya'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveMenu('students')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
                        >
                          Data Siswa &amp; Token
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                {/* Active Classroom Token Control (scoped to school) */}
                <TokenManagerCard
                  tokens={cbtTokens}
                  schoolName={effectiveSchool}
                />

                {/* 8 Required Live Database Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Jumlah Siswa Terdaftar
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                      {overviewStats.totalStudents}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Paket Ujian · Aktif
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                      {overviewStats.totalExams}{' '}
                      <span className="text-sm font-medium text-blue-700">
                        ({overviewStats.activeExams} aktif)
                      </span>
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Sudah · Belum Mengerjakan
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                      {overviewStats.participatedCount}{' '}
                      <span className="text-slate-400 font-normal">·</span>{' '}
                      <span className="text-slate-600">
                        {overviewStats.notParticipatedCount}
                      </span>
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Rata-Rata Nilai Terkoreksi
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-blue-700 mt-1">
                      {overviewStats.avgScore !== null
                        ? overviewStats.avgScore.toFixed(2)
                        : '-'}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Total Bank Soal Bersama
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">
                      {questions.length}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Soal Belum Diverifikasi
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-amber-700 mt-1">
                      {overviewStats.unverifiedQuestionsCount}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Gambar Belum Diverifikasi
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-amber-700 mt-1">
                      {overviewStats.unverifiedImagesCount}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">
                      Kunci Jawaban Terverifikasi
                    </div>
                    <div className="text-2xl font-bold font-mono-tabular text-emerald-700 mt-1">
                      {overviewStats.verifiedKeysCount} / {questions.length}
                    </div>
                  </div>
                </div>

                {/* Guided Operational Workflow */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Alur Kerja Penyelenggaraan Ujian TKA SD (Matematika &amp; Bahasa Indonesia)
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Mendukung paket soal asli <strong>TO 1 MTK.pdf</strong> (Matematika) dan{' '}
                      <strong>B.Indo 2.pdf</strong> (Bahasa Indonesia) lengkap dengan gambar asli PDF dan koreksi nilai otomatis untuk setiap sekolah.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-blue-700">
                          TAHAP 1 · DATA SISWA &amp; TOKEN
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          Daftarkan Siswa Sekolah Anda
                        </div>
                        <p className="text-xs text-slate-600">
                          Tambahkan siswa Kelas VI satu per satu atau impor CSV, lalu bagikan Token Ujian (tanpa perlu email siswa).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveMenu('students')}
                        className="inline-flex items-center justify-between px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        <span>Kelola Data Siswa</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-blue-700">
                          TAHAP 2 · BANK SOAL &amp; PDF
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          60 Soal Resmi + Impor PDF Baru
                        </div>
                        <p className="text-xs text-slate-600">
                          {questions.length >= 60
                            ? '60 soal resmi (Matematika & B. Indonesia) siap dipakai, atau unggah PDF soal tambahan milik sekolah Anda.'
                            : 'Muat ekstraksi resmi 30 soal TO 1 MTK.pdf dan 30 soal B.Indo 2.pdf beserta gambar asli.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveMenu('question_bank')}
                        className="inline-flex items-center justify-between px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        <span>Lihat Bank Soal</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-blue-700 inline-flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" />
                          TAHAP 3 · KUNCI &amp; KOREKSI AI
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          60 Kunci &amp; Pembahasan Otomatis
                        </div>
                        <p className="text-xs text-slate-600">
                          Seluruh 30 soal Matematika dan 30 soal Bahasa Indonesia telah dianalisis otomatis oleh AI dan siap mengoreksi jawaban siswa.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveMenu('answer_keys')}
                        className="inline-flex items-center justify-between px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        <span>Lihat Kunci &amp; Analisis</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-blue-700">
                          TAHAP 4 · JADWAL &amp; REKAP NILAI
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          Aktifkan Sesi &amp; Cetak Laporan
                        </div>
                        <p className="text-xs text-slate-600">
                          Atur durasi ujian sekolah Anda, pantau pengerjaan siswa secara langsung, dan unduh rekap nilai CSV / cetak PDF.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveMenu('exam_settings')}
                        className="inline-flex items-center justify-between px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                      >
                        <span>Pengaturan Ujian</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(activeMenu === 'pdf_import' ||
              activeMenu === 'question_bank' ||
              activeMenu === 'verify_questions' ||
              activeMenu === 'verify_images') && (
              <AdminPdfAndVerification
                activeSubTab={activeMenu}
                questions={questions}
                assets={assets}
                answerKeys={answerKeys}
                exams={scopedExams}
                isSuperAdmin={isSuperAdmin}
                onSwitchTab={(tab) => setActiveMenu(tab)}
              />
            )}

            {(activeMenu === 'answer_keys' || activeMenu === 'exam_settings') && (
              <AdminAnswerKeysAndExams
                activeSubTab={activeMenu}
                questions={questions}
                assets={assets}
                answerKeys={answerKeys}
                exams={scopedExams}
                allExams={exams}
                tokens={cbtTokens}
                adminSchoolName={
                  effectiveSchool !== 'ALL' ? effectiveSchool : adminSchoolName
                }
                isSuperAdmin={isSuperAdmin}
              />
            )}

            {(activeMenu === 'students' ||
              activeMenu === 'access_settings' ||
              activeMenu === 'audit_logs') && (
              <AdminStudentsAndAccess
                activeSubTab={activeMenu}
                users={users}
                studentDirectory={scopedStudents}
                allStudentDirectory={studentDirectory}
                tokens={cbtTokens}
                admins={admins}
                attempts={scopedAttempts}
                auditLogs={scopedAuditLogs}
                adminSchoolName={adminSchoolName}
                isSuperAdmin={isSuperAdmin}
                selectedSchoolFilter={selectedSchoolFilter}
                registrationSettings={registrationSettings}
              />
            )}

            {(activeMenu === 'participants' ||
              activeMenu === 'exam_results' ||
              activeMenu === 'score_recap' ||
              activeMenu === 'export_reports') && (
              <AdminResultsAndReports
                activeSubTab={activeMenu}
                exams={scopedExams}
                questions={questions}
                answerKeys={answerKeys}
                attempts={scopedAttempts}
                examGrades={scopedGrades}
                users={users}
                studentDirectory={scopedStudents}
              />
            )}
          </div>

          <div className="no-print mt-8">
            <AppFooter />
          </div>
        </main>
      </div>
    </div>
  );
};
