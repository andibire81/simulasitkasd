import React, { useMemo, useState } from 'react';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  History,
  KeyRound,
  Link2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Share2,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  UserX,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  FIREBASE_CONSOLE_AUTH_SETTINGS_URL,
  FIREBASE_PROJECT_ID,
  handleFirestoreError,
  OperationType,
  recordAuditLog,
} from '../../lib/firebase';
import {
  AdminRecord,
  AdminRegistrationMode,
  AdminRegistrationSettingsRecord,
  AttemptRecord,
  AuditLogRecord,
  CbtTokenRecord,
  clampStr,
  computeStudentDocIdForSchool,
  generateRandomTokenCode,
  normalizeSchoolName,
  normalizeStudentName,
  StudentDirectoryRecord,
  UserProfile,
  VALIDATION_BOUNDS,
} from '../../types/cbt';
import { TokenManagerCard } from './TokenManagerCard';

interface AdminStudentsAndAccessProps {
  activeSubTab: 'students' | 'access_settings' | 'audit_logs';
  users: UserProfile[];
  studentDirectory: StudentDirectoryRecord[];
  allStudentDirectory?: StudentDirectoryRecord[];
  tokens: CbtTokenRecord[];
  admins: AdminRecord[];
  attempts: AttemptRecord[];
  auditLogs: AuditLogRecord[];
  adminSchoolName?: string;
  isSuperAdmin?: boolean;
  selectedSchoolFilter?: string;
  registrationSettings?: AdminRegistrationSettingsRecord;
}

function formatTimestamp(ts?: { toDate?: () => Date }): string {
  if (!ts || typeof ts.toDate !== 'function') return '-';
  const d = ts.toDate();
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function generateUniqueStudentToken(usedCodes: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = generateRandomTokenCode(6);
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }
  const fallback = generateRandomTokenCode(8);
  usedCodes.add(fallback);
  return fallback;
}

export const AdminStudentsAndAccess: React.FC<AdminStudentsAndAccessProps> = ({
  activeSubTab,
  users,
  studentDirectory,
  allStudentDirectory,
  tokens,
  admins,
  attempts,
  auditLogs,
  adminSchoolName = 'Penyelenggara TKA SD',
  isSuperAdmin = false,
  selectedSchoolFilter = 'ALL',
  registrationSettings,
}) => {
  const globalStudents = allStudentDirectory || studentDirectory;

  // Student Form State (Name + Token issued by Admin — no email)
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingRow, setEditingRow] = useState<StudentDirectoryRecord | null>(null);
  const [fullName, setFullName] = useState('');
  const [participantNumber, setParticipantNumber] = useState('');
  const [className, setClassName] = useState('VI-A');
  const [schoolName, setSchoolName] = useState('');
  const [tokenMode, setTokenMode] = useState<'issue_now' | 'withhold'>('issue_now');
  const [personalTokenCode, setPersonalTokenCode] = useState('');

  const [formBusy, setFormBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');
  const [tokenFilter, setTokenFilter] = useState<'ALL' | 'READY' | 'PENDING'>('ALL');

  // Confirmation, Bulk Token & Print Modals
  const [confirmToggleRow, setConfirmToggleRow] = useState<StudentDirectoryRecord | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<StudentDirectoryRecord | null>(null);
  const [historyRow, setHistoryRow] = useState<StudentDirectoryRecord | null>(null);
  const [showBulkTokenModal, setShowBulkTokenModal] = useState(false);
  const [showPrintCardsModal, setShowPrintCardsModal] = useState(false);

  // CSV Bulk Import State
  const [showCsvPanel, setShowCsvPanel] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvAutoIssueToken, setCsvAutoIssueToken] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);

  // Access Settings & Multi-School Registration State
  const [selectedPromoteUid, setSelectedPromoteUid] = useState('');
  const [promoteSchoolName, setPromoteSchoolName] = useState('');
  const [confirmRevokeAdmin, setConfirmRevokeAdmin] = useState<AdminRecord | null>(null);
  const [regModeDraft, setRegModeDraft] = useState<AdminRegistrationMode>(
    registrationSettings?.mode || 'open'
  );
  const [welcomeNoteDraft, setWelcomeNoteDraft] = useState<string>(
    registrationSettings?.welcomeNote ||
      'Terbuka bagi Guru Kelas VI, Proktor CBT, dan Operator Sekolah Dasar untuk menyelenggarakan simulasi TKA SD di sekolah masing-masing.'
  );
  const [savingRegSettings, setSavingRegSettings] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState<'link' | 'wa' | null>(null);

  // Self-profile edit state for School Admins
  const myAdminDoc = useMemo(
    () => admins.find((a) => a.uid === auth.currentUser?.uid) || null,
    [admins]
  );
  const [myFullNameDraft, setMyFullNameDraft] = useState('');
  const [mySchoolDraft, setMySchoolDraft] = useState('');
  const [myPositionDraft, setMyPositionDraft] = useState('');
  const [editingMyProfile, setEditingMyProfile] = useState(false);

  React.useEffect(() => {
    if (registrationSettings) {
      setRegModeDraft(registrationSettings.mode);
      setWelcomeNoteDraft(registrationSettings.welcomeNote || '');
    }
  }, [registrationSettings?.mode, registrationSettings?.welcomeNote]);

  // Token Lookup Maps
  const getActiveClassroomTokenForSchool = (stuSchoolName: string) => {
    const schoolClassroom = tokens.find(
      (t) =>
        (!t.scope || t.scope === 'classroom') &&
        t.active &&
        Boolean(t.schoolName) &&
        t.schoolName !== 'Semua' &&
        normalizeSchoolName(t.schoolName || '') === normalizeSchoolName(stuSchoolName)
    );
    if (schoolClassroom) return schoolClassroom;
    return (
      tokens.find(
        (t) =>
          (!t.scope || t.scope === 'classroom') &&
          t.active &&
          (!t.schoolName ||
            t.schoolName === 'Semua' ||
            (t.schoolName === 'Penyelenggara TKA SD' &&
              stuSchoolName === 'Penyelenggara TKA SD'))
      ) || null
    );
  };

  const activeClassroomToken = useMemo(() => {
    const targetSchool =
      isSuperAdmin && selectedSchoolFilter === 'ALL'
        ? 'Semua'
        : isSuperAdmin
        ? selectedSchoolFilter
        : adminSchoolName;
    if (targetSchool === 'Semua') {
      return (
        tokens.find(
          (t) =>
            (!t.scope || t.scope === 'classroom') &&
            t.active &&
            (!t.schoolName ||
              t.schoolName === 'Semua' ||
              t.schoolName === 'Penyelenggara TKA SD')
        ) || null
      );
    }
    return getActiveClassroomTokenForSchool(targetSchool);
  }, [tokens, isSuperAdmin, selectedSchoolFilter, adminSchoolName]);

  const personalTokenByStudentId = useMemo(() => {
    const map = new Map<string, CbtTokenRecord>();
    for (const t of tokens) {
      if (t.scope === 'student' && t.studentId) {
        const existing = map.get(t.studentId);
        if (!existing || (!existing.active && t.active)) {
          map.set(t.studentId, t);
        }
      }
    }
    return map;
  }, [tokens]);

  const getEffectiveStudentTokenInfo = (row: StudentDirectoryRecord) => {
    const personal = personalTokenByStudentId.get(row.id) || null;
    const isWithheld = row.tokenStatus === 'withheld';
    if (row.accountStatus !== 'active') {
      return {
        ready: false,
        code: '',
        sourceLabel: 'Peserta Nonaktif',
        personal,
      };
    }
    if (isWithheld) {
      return {
        ready: false,
        code: '',
        sourceLabel: 'Belum Diberi Token',
        personal,
      };
    }
    if (personal && personal.active) {
      return {
        ready: true,
        code: personal.code,
        sourceLabel: 'Token Khusus Siswa',
        personal,
      };
    }
    const matchingClassroom = getActiveClassroomTokenForSchool(row.schoolName);
    if (matchingClassroom) {
      return {
        ready: true,
        code: matchingClassroom.code,
        sourceLabel: 'Token Kelas',
        personal,
      };
    }
    return {
      ready: false,
      code: '',
      sourceLabel: 'Belum Ada Token Aktif',
      personal,
    };
  };

  const sortedStudents = useMemo<StudentDirectoryRecord[]>(() => {
    return [...studentDirectory].sort((a, b) => {
      const clsCmp = a.className.localeCompare(b.className, 'id');
      if (clsCmp !== 0) return clsCmp;
      return a.fullName.localeCompare(b.fullName, 'id');
    });
  }, [studentDirectory]);

  const readyToLoginCount = useMemo(() => {
    let count = 0;
    for (const s of sortedStudents) {
      if (getEffectiveStudentTokenInfo(s).ready) count++;
    }
    return count;
  }, [sortedStudents, personalTokenByStudentId, activeClassroomToken]);

  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    sortedStudents.forEach((s) => {
      if (s.className) set.add(s.className);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [sortedStudents]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedStudents.filter((s) => {
      if (classFilter !== 'ALL' && s.className !== classFilter) return false;
      const info = getEffectiveStudentTokenInfo(s);
      if (tokenFilter === 'READY' && !info.ready) return false;
      if (tokenFilter === 'PENDING' && info.ready) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.participantNumber.toLowerCase().includes(q) ||
        s.schoolName.toLowerCase().includes(q) ||
        info.code.toLowerCase().includes(q)
      );
    });
  }, [
    sortedStudents,
    searchQuery,
    classFilter,
    tokenFilter,
    personalTokenByStudentId,
    activeClassroomToken,
  ]);

  // Audit Log Search
  const [logSearch, setLogSearch] = useState('');

  const openCreateStudent = () => {
    const used = new Set(tokens.map((t) => t.code));
    const defaultSchool = !isSuperAdmin
      ? adminSchoolName
      : selectedSchoolFilter !== 'ALL'
      ? selectedSchoolFilter
      : adminSchoolName && adminSchoolName !== 'Penyelenggara TKA SD'
      ? adminSchoolName
      : 'SD Negeri 1';
    setEditingRow(null);
    setFullName('');
    setParticipantNumber('');
    setClassName('VI-A');
    setSchoolName(defaultSchool);
    setTokenMode('issue_now');
    setPersonalTokenCode(generateUniqueStudentToken(used));
    setFeedback(null);
    setShowStudentModal(true);
  };

  const openEditStudent = (row: StudentDirectoryRecord) => {
    const personal = personalTokenByStudentId.get(row.id);
    setEditingRow(row);
    setFullName(row.fullName);
    setParticipantNumber(row.participantNumber);
    setClassName(row.className);
    setSchoolName(row.schoolName);
    setTokenMode(row.tokenStatus === 'withheld' ? 'withhold' : 'issue_now');
    setPersonalTokenCode(personal ? personal.code : '');
    setFeedback(null);
    setShowStudentModal(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const adminUid = auth.currentUser?.uid;
    if (!adminUid) return;

    const cleanName = clampStr(
      fullName.replace(/\s+/g, ' '),
      VALIDATION_BOUNDS.NAME_MAX_LEN
    );
    const cleanNorm = normalizeStudentName(cleanName);
    const cleanNum = clampStr(
      participantNumber,
      VALIDATION_BOUNDS.PARTICIPANT_NUMBER_MAX_LEN
    );
    const cleanClass = clampStr(className, VALIDATION_BOUNDS.CLASS_MAX_LEN);
    const cleanSchool = clampStr(schoolName, VALIDATION_BOUNDS.SCHOOL_MAX_LEN);
    const cleanPersonalCode = personalTokenCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!cleanName || !cleanNorm || !cleanNum || !cleanClass || !cleanSchool) {
      setFeedback({
        type: 'err',
        text: 'Seluruh kolom identitas siswa (Nama Lengkap, Nomor Peserta, Kelas, dan Asal Sekolah) wajib diisi.',
      });
      return;
    }

    if (
      tokenMode === 'issue_now' &&
      cleanPersonalCode.length > 0 &&
      (cleanPersonalCode.length < VALIDATION_BOUNDS.TOKEN_MIN_LEN ||
        cleanPersonalCode.length > VALIDATION_BOUNDS.TOKEN_MAX_LEN ||
        !VALIDATION_BOUNDS.TOKEN_REGEX.test(cleanPersonalCode))
    ) {
      setFeedback({
        type: 'err',
        text: 'Token Khusus Siswa harus terdiri atas 4–16 huruf kapital/angka (atau kosongkan jika memakai Token Kelas).',
      });
      return;
    }

    const effectiveSchool = isSuperAdmin
      ? cleanSchool
      : clampStr(adminSchoolName || cleanSchool, VALIDATION_BOUNDS.SCHOOL_MAX_LEN);

    const computedId =
      editingRow &&
      normalizeStudentName(editingRow.fullName) === cleanNorm &&
      normalizeSchoolName(editingRow.schoolName) === normalizeSchoolName(effectiveSchool)
        ? editingRow.id
        : computeStudentDocIdForSchool(cleanName, effectiveSchool);

    // Check token collision against other students or classroom tokens
    if (tokenMode === 'issue_now' && cleanPersonalCode) {
      const collidingToken = tokens.find(
        (t) =>
          t.code === cleanPersonalCode &&
          ((!t.scope || t.scope === 'classroom') ||
            (t.scope === 'student' &&
              t.studentId !== computedId &&
              t.studentId !== editingRow?.id))
      );
      if (collidingToken) {
        setFeedback({
          type: 'err',
          text: `Kode token "${cleanPersonalCode}" sudah digunakan. Klik Acak Kode untuk membuat kode lain.`,
        });
        return;
      }
    }

    const nextTokenStatus: 'issued' | 'withheld' =
      tokenMode === 'issue_now' ? 'issued' : 'withheld';

    setFormBusy(true);
    setFeedback(null);
    try {
      const batch = writeBatch(db);

      if (editingRow) {
        if (computedId !== editingRow.id) {
          const duplicate = globalStudents.find((d) => d.id === computedId);
          if (duplicate) {
            setFeedback({
              type: 'err',
              text: `Nama "${cleanName}" sudah terdaftar pada daftar peserta sekolah ini. Tambahkan pembeda (misal inisial atau kelas) agar nama siswa unik saat masuk.`,
            });
            setFormBusy(false);
            return;
          }

          batch.set(doc(db, 'studentDirectory', computedId), {
            id: computedId,
            fullName: cleanName,
            normalizedName: cleanNorm,
            participantNumber: cleanNum,
            className: cleanClass,
            schoolName: effectiveSchool,
            tokenStatus: nextTokenStatus,
            accountStatus: editingRow.accountStatus,
            createdBy: editingRow.createdBy || adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.delete(doc(db, 'studentDirectory', editingRow.id));
        } else {
          batch.update(doc(db, 'studentDirectory', editingRow.id), {
            fullName: cleanName,
            normalizedName: cleanNorm,
            participantNumber: cleanNum,
            className: cleanClass,
            schoolName: effectiveSchool,
            tokenStatus: nextTokenStatus,
            accountStatus: editingRow.accountStatus,
            updatedAt: serverTimestamp(),
          });
        }

        // Clean up any previous personal tokens for editingRow.id or computedId that differ from cleanPersonalCode
        const prevStudentTokens = tokens.filter(
          (t) =>
            t.scope === 'student' &&
            (t.studentId === editingRow.id || t.studentId === computedId)
        );
        for (const oldTok of prevStudentTokens) {
          if (nextTokenStatus === 'withheld' || oldTok.code !== cleanPersonalCode) {
            batch.delete(doc(db, 'cbtTokens', oldTok.code));
          }
        }
      } else {
        const duplicate = globalStudents.find((d) => d.id === computedId);
        if (duplicate) {
          setFeedback({
            type: 'err',
            text: `Siswa dengan nama "${cleanName}" sudah terdaftar (${duplicate.participantNumber} · Kelas ${duplicate.className}). Gunakan tombol Ubah pada baris siswa tersebut.`,
          });
          setFormBusy(false);
          return;
        }

        batch.set(doc(db, 'studentDirectory', computedId), {
          id: computedId,
          fullName: cleanName,
          normalizedName: cleanNorm,
          participantNumber: cleanNum,
          className: cleanClass,
          schoolName: effectiveSchool,
          tokenStatus: nextTokenStatus,
          accountStatus: 'active',
          createdBy: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (nextTokenStatus === 'issued' && cleanPersonalCode) {
        const existingCodeDoc = tokens.find((t) => t.code === cleanPersonalCode);
        if (existingCodeDoc) {
          batch.update(doc(db, 'cbtTokens', cleanPersonalCode), {
            label: clampStr(`Token Peserta CBT (${cleanNum})`, 120),
            scope: 'student',
            studentId: computedId,
            schoolName: effectiveSchool,
            active: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'cbtTokens', cleanPersonalCode), {
            code: cleanPersonalCode,
            label: clampStr(`Token Peserta CBT (${cleanNum})`, 120),
            scope: 'student',
            studentId: computedId,
            schoolName: effectiveSchool,
            active: true,
            createdBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();

      await recordAuditLog({
        action: editingRow ? 'UPDATE_STUDENT' : 'CREATE_STUDENT',
        targetType: 'studentDirectory',
        targetId: computedId,
        summary: `${editingRow ? 'Memperbarui' : 'Mendata'} siswa ${cleanName} (${cleanNum} · Kelas ${cleanClass}) — ${
          nextTokenStatus === 'issued'
            ? cleanPersonalCode
              ? `Token Khusus: ${cleanPersonalCode}`
              : 'Mengikuti Token Kelas'
            : 'Token belum diberikan (ditahan)'
        }`,
      });

      setFeedback({
        type: 'ok',
        text:
          nextTokenStatus === 'issued'
            ? cleanPersonalCode
              ? `Siswa ${cleanName} berhasil didata dengan Token Masuk: ${cleanPersonalCode}.`
              : `Siswa ${cleanName} berhasil didata (menggunakan Token Kelas aktif).`
            : `Nama siswa ${cleanName} berhasil didata. Siswa belum dapat masuk sebelum Anda memberikan Token.`,
      });
      setShowStudentModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'studentDirectory');
    } finally {
      setFormBusy(false);
    }
  };

  // Quick 1-click issue or withhold token for a single student row
  const handleQuickToggleStudentToken = async (row: StudentDirectoryRecord) => {
    const adminUid = auth.currentUser?.uid;
    if (!adminUid) return;

    const info = getEffectiveStudentTokenInfo(row);
    setFormBusy(true);
    setFeedback(null);
    try {
      const batch = writeBatch(db);
      if (info.ready) {
        // Withhold token access for this student
        batch.update(doc(db, 'studentDirectory', row.id), {
          fullName: row.fullName,
          normalizedName: row.normalizedName || normalizeStudentName(row.fullName),
          participantNumber: row.participantNumber,
          className: row.className,
          schoolName: row.schoolName,
          tokenStatus: 'withheld',
          accountStatus: row.accountStatus,
          updatedAt: serverTimestamp(),
        });
        const stuTokens = tokens.filter(
          (t) => t.scope === 'student' && t.studentId === row.id && t.active
        );
        for (const st of stuTokens) {
          batch.update(doc(db, 'cbtTokens', st.code), {
            label: clampStr(st.label || `Token Peserta CBT (${row.participantNumber})`, 120),
            scope: 'student',
            studentId: row.id,
            schoolName: clampStr(row.schoolName, 120),
            active: false,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        await recordAuditLog({
          action: 'WITHHOLD_STUDENT_TOKEN',
          targetType: 'studentDirectory',
          targetId: row.id,
          summary: `Menahan sementara akses Token ujian siswa ${row.fullName} (${row.participantNumber})`,
        });
        setFeedback({
          type: 'ok',
          text: `Token untuk ${row.fullName} ditahan. Siswa ini tidak dapat masuk sebelum diberi token kembali.`,
        });
      } else {
        // Issue & activate token for this student immediately
        const used = new Set(tokens.map((t) => t.code));
        const existingPersonal = personalTokenByStudentId.get(row.id);
        let issuedCode = '';

        batch.update(doc(db, 'studentDirectory', row.id), {
          fullName: row.fullName,
          normalizedName: row.normalizedName || normalizeStudentName(row.fullName),
          participantNumber: row.participantNumber,
          className: row.className,
          schoolName: row.schoolName,
          tokenStatus: 'issued',
          accountStatus: 'active',
          updatedAt: serverTimestamp(),
        });

        if (existingPersonal) {
          issuedCode = existingPersonal.code;
          batch.update(doc(db, 'cbtTokens', existingPersonal.code), {
            label: clampStr(`Token Peserta CBT (${row.participantNumber})`, 120),
            scope: 'student',
            studentId: row.id,
            schoolName: clampStr(row.schoolName, 120),
            active: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          issuedCode = generateUniqueStudentToken(used);
          batch.set(doc(db, 'cbtTokens', issuedCode), {
            code: issuedCode,
            label: clampStr(`Token Peserta CBT (${row.participantNumber})`, 120),
            scope: 'student',
            studentId: row.id,
            schoolName: clampStr(row.schoolName, 120),
            active: true,
            createdBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        await recordAuditLog({
          action: 'ISSUE_STUDENT_TOKEN',
          targetType: 'studentDirectory',
          targetId: row.id,
          summary: `Memberikan Token Masuk ${issuedCode} kepada siswa ${row.fullName} (${row.participantNumber})`,
        });
        setFeedback({
          type: 'ok',
          text: `Token ${issuedCode} berhasil diberikan untuk ${row.fullName}. Siswa kini dapat masuk ujian.`,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `studentDirectory/${row.id}`);
    } finally {
      setFormBusy(false);
    }
  };

  // Bulk generate & activate unique personal tokens for all active students
  const handleBulkIssueUniqueTokens = async () => {
    const adminUid = auth.currentUser?.uid;
    if (!adminUid) return;

    const activeStudents = sortedStudents.filter((s) => s.accountStatus === 'active');
    if (activeStudents.length === 0) {
      setShowBulkTokenModal(false);
      setFeedback({ type: 'err', text: 'Belum ada siswa aktif pada daftar Data Siswa.' });
      return;
    }

    setFormBusy(true);
    setFeedback(null);
    try {
      const used = new Set(tokens.map((t) => t.code));
      const batch = writeBatch(db);
      let issuedCount = 0;

      for (const stu of activeStudents) {
        const existingPersonal = personalTokenByStudentId.get(stu.id);
        batch.update(doc(db, 'studentDirectory', stu.id), {
          fullName: stu.fullName,
          normalizedName: stu.normalizedName || normalizeStudentName(stu.fullName),
          participantNumber: stu.participantNumber,
          className: stu.className,
          schoolName: stu.schoolName,
          tokenStatus: 'issued',
          accountStatus: 'active',
          updatedAt: serverTimestamp(),
        });

        if (existingPersonal) {
          batch.update(doc(db, 'cbtTokens', existingPersonal.code), {
            label: clampStr(`Token Peserta CBT (${stu.participantNumber})`, 120),
            scope: 'student',
            studentId: stu.id,
            schoolName: clampStr(stu.schoolName, 120),
            active: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          const code = generateUniqueStudentToken(used);
          batch.set(doc(db, 'cbtTokens', code), {
            code,
            label: clampStr(`Token Peserta CBT (${stu.participantNumber})`, 120),
            scope: 'student',
            studentId: stu.id,
            schoolName: clampStr(stu.schoolName, 120),
            active: true,
            createdBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        issuedCount++;
      }

      await batch.commit();
      await recordAuditLog({
        action: 'BULK_ISSUE_STUDENT_TOKENS',
        targetType: 'studentDirectory',
        targetId: `bulk_${issuedCount}`,
        summary: `Memberikan & mengaktifkan Token Unik untuk ${issuedCount} siswa terdaftar`,
      });
      setShowBulkTokenModal(false);
      setFeedback({
        type: 'ok',
        text: `Berhasil memberikan Token Unik aktif untuk ${issuedCount} siswa terdaftar. Anda dapat mencetak daftar Nama & Token melalui tombol Cetak Token.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'studentDirectory');
    } finally {
      setFormBusy(false);
    }
  };

  const handleCopyStudentCredential = async (row: StudentDirectoryRecord, code: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(
        `Nama Lengkap: ${row.fullName}\nToken Ujian: ${code}`
      );
      setCopiedStudentId(row.id);
      window.setTimeout(() => setCopiedStudentId(null), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleToggleAccountStatus = async (row: StudentDirectoryRecord) => {
    const nextStatus: 'active' | 'inactive' =
      row.accountStatus === 'active' ? 'inactive' : 'active';
    setFormBusy(true);
    try {
      await updateDoc(doc(db, 'studentDirectory', row.id), {
        fullName: row.fullName,
        normalizedName: row.normalizedName || normalizeStudentName(row.fullName),
        participantNumber: row.participantNumber,
        className: row.className,
        schoolName: row.schoolName,
        tokenStatus: row.tokenStatus === 'withheld' ? 'withheld' : 'issued',
        accountStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        action: nextStatus === 'active' ? 'ACTIVATE_STUDENT' : 'DEACTIVATE_STUDENT',
        targetType: 'studentDirectory',
        targetId: row.id,
        summary: `${nextStatus === 'active' ? 'Mengaktifkan' : 'Menonaktifkan'} akses peserta ${row.fullName} (${row.participantNumber})`,
      });
      setConfirmToggleRow(null);
      setFeedback({
        type: 'ok',
        text: `Status peserta ${row.fullName} diubah menjadi ${nextStatus === 'active' ? 'Aktif' : 'Nonaktif'}.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `studentDirectory/${row.id}`);
    } finally {
      setFormBusy(false);
    }
  };

  const handleDeleteStudent = async (row: StudentDirectoryRecord) => {
    setFormBusy(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'studentDirectory', row.id));
      const stuTokens = tokens.filter(
        (t) => t.scope === 'student' && t.studentId === row.id
      );
      for (const st of stuTokens) {
        batch.delete(doc(db, 'cbtTokens', st.code));
      }
      await batch.commit();

      await recordAuditLog({
        action: 'DELETE_STUDENT',
        targetType: 'studentDirectory',
        targetId: row.id,
        summary: `Menghapus data siswa ${row.fullName} (${row.participantNumber}) beserta token khususnya`,
      });
      setConfirmDeleteRow(null);
      setFeedback({ type: 'ok', text: `Data siswa ${row.fullName} telah dihapus.` });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `studentDirectory/${row.id}`);
    } finally {
      setFormBusy(false);
    }
  };

  const handleBulkCsvImport = async () => {
    const adminUid = auth.currentUser?.uid;
    if (!adminUid) return;

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setFeedback({ type: 'err', text: 'Tempelkan baris CSV terlebih dahulu.' });
      return;
    }

    const parsedById = new Map<
      string,
      {
        id: string;
        participantNumber: string;
        fullName: string;
        normalizedName: string;
        className: string;
        schoolName: string;
        explicitToken: string;
      }
    >();

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const cols = raw.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      if (
        i === 0 &&
        (cols[0]?.toLowerCase().includes('nomor') ||
          cols[1]?.toLowerCase().includes('nama'))
      ) {
        continue; // skip header row
      }
      if (cols.length < 3) {
        setFeedback({
          type: 'err',
          text: `Baris ke-${i + 1} kurang lengkap. Gunakan format: nomor_peserta,nama_lengkap,kelas[,sekolah,token_opsional]`,
        });
        return;
      }
      const pNum = clampStr(cols[0], VALIDATION_BOUNDS.PARTICIPANT_NUMBER_MAX_LEN);
      const fName = clampStr(
        cols[1].replace(/\s+/g, ' '),
        VALIDATION_BOUNDS.NAME_MAX_LEN
      );
      const normName = normalizeStudentName(fName);
      const cls = clampStr(cols[2], VALIDATION_BOUNDS.CLASS_MAX_LEN);
      const rawSchCol = cols[3] || adminSchoolName;
      const sch = clampStr(
        isSuperAdmin ? rawSchCol : adminSchoolName || rawSchCol,
        VALIDATION_BOUNDS.SCHOOL_MAX_LEN
      );
      const optToken = (cols[4] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (!pNum || !fName || !normName || !cls || !sch) {
        setFeedback({
          type: 'err',
          text: `Data tidak valid pada baris ke-${i + 1} (${raw}). Pastikan nomor peserta, nama lengkap, dan kelas terisi.`,
        });
        return;
      }
      if (
        optToken &&
        (optToken.length < VALIDATION_BOUNDS.TOKEN_MIN_LEN ||
          optToken.length > VALIDATION_BOUNDS.TOKEN_MAX_LEN)
      ) {
        setFeedback({
          type: 'err',
          text: `Token pada baris ke-${i + 1} ("${optToken}") harus 4–16 karakter huruf/angka.`,
        });
        return;
      }

      const id = computeStudentDocIdForSchool(fName, sch);
      parsedById.set(id, {
        id,
        participantNumber: pNum,
        fullName: fName,
        normalizedName: normName,
        className: cls,
        schoolName: sch,
        explicitToken: optToken,
      });
    }

    const parsed = Array.from(parsedById.values());
    if (parsed.length === 0) {
      setFeedback({ type: 'err', text: 'Tidak ada baris data siswa yang dapat diimpor.' });
      return;
    }

    setCsvBusy(true);
    setFeedback(null);
    try {
      const existingById = new Map(globalStudents.map((d) => [d.id, d]));
      const usedCodes = new Set(tokens.map((t) => t.code));
      const batch = writeBatch(db);

      for (const item of parsed) {
        const prev = existingById.get(item.id);
        const existingPersonal = personalTokenByStudentId.get(item.id);
        const shouldIssue = Boolean(item.explicitToken) || csvAutoIssueToken;
        const nextTokenStatus: 'issued' | 'withheld' = shouldIssue ? 'issued' : 'withheld';

        if (prev) {
          batch.update(doc(db, 'studentDirectory', item.id), {
            fullName: item.fullName,
            normalizedName: item.normalizedName,
            participantNumber: item.participantNumber,
            className: item.className,
            schoolName: item.schoolName,
            tokenStatus: nextTokenStatus,
            accountStatus: prev.accountStatus,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'studentDirectory', item.id), {
            id: item.id,
            fullName: item.fullName,
            normalizedName: item.normalizedName,
            participantNumber: item.participantNumber,
            className: item.className,
            schoolName: item.schoolName,
            tokenStatus: nextTokenStatus,
            accountStatus: 'active',
            createdBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (shouldIssue) {
          const targetCode =
            item.explicitToken ||
            existingPersonal?.code ||
            generateUniqueStudentToken(usedCodes);
          usedCodes.add(targetCode);

          if (existingPersonal && existingPersonal.code !== targetCode) {
            batch.delete(doc(db, 'cbtTokens', existingPersonal.code));
          }

          const codeAlreadyInDb = tokens.find((t) => t.code === targetCode);
          if (codeAlreadyInDb) {
            batch.update(doc(db, 'cbtTokens', targetCode), {
              label: clampStr(`Token Peserta CBT (${item.participantNumber})`, 120),
              scope: 'student',
              studentId: item.id,
              schoolName: item.schoolName,
              active: true,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(doc(db, 'cbtTokens', targetCode), {
              code: targetCode,
              label: clampStr(`Token Peserta CBT (${item.participantNumber})`, 120),
              scope: 'student',
              studentId: item.id,
              schoolName: item.schoolName,
              active: true,
              createdBy: adminUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      await batch.commit();
      await recordAuditLog({
        action: 'IMPORT_STUDENTS_CSV',
        targetType: 'studentDirectory',
        targetId: `batch_${parsed.length}`,
        summary: `Mendata ${parsed.length} siswa melalui CSV (${csvAutoIssueToken ? 'beserta pembuatan Token Unik' : 'tanpa token awal'})`,
      });
      setCsvText('');
      setShowCsvPanel(false);
      setFeedback({
        type: 'ok',
        text: csvAutoIssueToken
          ? `Berhasil mendata ${parsed.length} siswa sekaligus membuatkan Token Unik masing-masing.`
          : `Berhasil mendata ${parsed.length} nama siswa (status token ditahan sampai Anda memberikan token).`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'studentDirectory');
    } finally {
      setCsvBusy(false);
    }
  };

  const handleCsvFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCsvText(reader.result);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // Promote existing verified teacher Google account to Admin (Super Admin)
  const handlePromoteToAdmin = async () => {
    const targetUser = users.find((u) => u.uid === selectedPromoteUid);
    const currentUid = auth.currentUser?.uid;
    if (!targetUser || !currentUid) return;

    const assignedSchool = clampStr(
      promoteSchoolName || targetUser.schoolName || 'SD Negeri',
      VALIDATION_BOUNDS.SCHOOL_MAX_LEN
    );

    setFormBusy(true);
    setFeedback(null);
    try {
      await setDoc(doc(db, 'admins', targetUser.uid), {
        uid: targetUser.uid,
        email: clampStr(targetUser.email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
        fullName: clampStr(targetUser.fullName, VALIDATION_BOUNDS.NAME_MAX_LEN),
        schoolName: assignedSchool,
        position: 'Admin CBT Sekolah',
        status: 'active',
        createdBy: currentUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', targetUser.uid), {
        fullName: targetUser.fullName,
        participantNumber: targetUser.participantNumber,
        className: 'ADMIN',
        schoolName: assignedSchool,
        email: targetUser.email,
        role: 'admin',
        accountStatus: 'active',
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        action: 'GRANT_ADMIN_ROLE',
        targetType: 'admins',
        targetId: targetUser.uid,
        summary: `Memberikan hak akses Administrator kepada ${targetUser.fullName} (${assignedSchool} · ${targetUser.email})`,
      });
      setSelectedPromoteUid('');
      setPromoteSchoolName('');
      setFeedback({
        type: 'ok',
        text: `${targetUser.fullName} (${assignedSchool}) kini aktif sebagai Administrator.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${targetUser.uid}`);
    } finally {
      setFormBusy(false);
    }
  };

  const handleSetAdminStatus = async (
    adm: AdminRecord,
    nextStatus: 'active' | 'suspended'
  ) => {
    setFormBusy(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'admins', adm.uid), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      const existingUser = users.find((u) => u.uid === adm.uid);
      if (existingUser) {
        await updateDoc(doc(db, 'users', adm.uid), {
          fullName: existingUser.fullName,
          participantNumber: existingUser.participantNumber,
          className: nextStatus === 'active' ? 'ADMIN' : existingUser.className,
          schoolName: adm.schoolName || existingUser.schoolName,
          email: existingUser.email,
          role: nextStatus === 'active' ? 'admin' : 'student',
          accountStatus: existingUser.accountStatus,
          updatedAt: serverTimestamp(),
        });
      }
      await recordAuditLog({
        action: nextStatus === 'active' ? 'APPROVE_SCHOOL_ADMIN' : 'SUSPEND_SCHOOL_ADMIN',
        targetType: 'admins',
        targetId: adm.uid,
        summary: `${
          nextStatus === 'active' ? 'Menyetujui/mengaktifkan' : 'Menonaktifkan'
        } Admin Sekolah ${adm.fullName} (${adm.schoolName || '-'} · ${adm.email})`,
      });
      setFeedback({
        type: 'ok',
        text:
          nextStatus === 'active'
            ? `Akun Admin ${adm.fullName} (${adm.schoolName || 'Sekolah'}) telah disetujui dan aktif.`
            : `Akun Admin ${adm.fullName} telah dinonaktifkan sementara.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `admins/${adm.uid}`);
    } finally {
      setFormBusy(false);
    }
  };

  const handleSaveRegistrationSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const actorEmail =
      auth.currentUser?.email || BOOTSTRAPPED_ADMIN_EMAIL;
    setSavingRegSettings(true);
    setFeedback(null);
    try {
      const regRef = doc(db, 'adminSettings', 'registration');
      const snap = await getDoc(regRef);
      const cleanNote = clampStr(
        welcomeNoteDraft,
        VALIDATION_BOUNDS.WELCOME_NOTE_MAX_LEN
      );
      if (snap.exists()) {
        await updateDoc(regRef, {
          mode: regModeDraft,
          welcomeNote: cleanNote,
          updatedBy: clampStr(actorEmail, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(regRef, {
          id: 'registration',
          mode: regModeDraft,
          welcomeNote: cleanNote,
          updatedBy: clampStr(actorEmail, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
          updatedAt: serverTimestamp(),
        });
      }
      await recordAuditLog({
        action: 'UPDATE_ADMIN_REGISTRATION_MODE',
        targetType: 'adminSettings',
        targetId: 'registration',
        summary: `Mengubah kebijakan pendaftaran Admin Sekolah menjadi "${regModeDraft.toUpperCase()}"`,
      });
      setFeedback({
        type: 'ok',
        text: 'Pengaturan kemudahan pendaftaran Admin Sekolah berhasil disimpan.',
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'adminSettings/registration');
    } finally {
      setSavingRegSettings(false);
    }
  };

  const handleSaveMySchoolProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = auth.currentUser?.uid;
    if (!uid || !myAdminDoc) return;
    const cleanName = clampStr(myFullNameDraft, VALIDATION_BOUNDS.NAME_MAX_LEN);
    const cleanSchool = clampStr(mySchoolDraft, VALIDATION_BOUNDS.SCHOOL_MAX_LEN);
    const cleanPos = clampStr(myPositionDraft, VALIDATION_BOUNDS.POSITION_MAX_LEN);
    if (!cleanName || cleanSchool.length < 3 || !cleanPos) {
      setFeedback({
        type: 'err',
        text: 'Nama Lengkap, Nama Sekolah (minimal 3 karakter), dan Jabatan wajib diisi.',
      });
      return;
    }
    setFormBusy(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'admins', uid), {
        fullName: cleanName,
        schoolName: cleanSchool,
        position: cleanPos,
        updatedAt: serverTimestamp(),
      });
      const myUser = users.find((u) => u.uid === uid);
      if (myUser) {
        await updateDoc(doc(db, 'users', uid), {
          fullName: cleanName,
          participantNumber: myUser.participantNumber,
          className: 'ADMIN',
          schoolName: cleanSchool,
          email: myUser.email,
          role: 'admin',
          accountStatus: 'active',
          updatedAt: serverTimestamp(),
        });
      }
      setEditingMyProfile(false);
      setFeedback({
        type: 'ok',
        text: `Identitas sekolah diperbarui menjadi "${cleanSchool}".`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `admins/${uid}`);
    } finally {
      setFormBusy(false);
    }
  };

  const handleRevokeAdmin = async (adm: AdminRecord) => {
    setFormBusy(true);
    setFeedback(null);
    try {
      await deleteDoc(doc(db, 'admins', adm.uid));
      const existingUser = users.find((u) => u.uid === adm.uid);
      if (existingUser) {
        await updateDoc(doc(db, 'users', adm.uid), {
          fullName: existingUser.fullName,
          participantNumber: existingUser.participantNumber,
          className: existingUser.className,
          schoolName: existingUser.schoolName,
          email: existingUser.email,
          role: 'student',
          accountStatus: existingUser.accountStatus,
          updatedAt: serverTimestamp(),
        });
      }
      await recordAuditLog({
        action: 'REVOKE_ADMIN_ROLE',
        targetType: 'admins',
        targetId: adm.uid,
        summary: `Mencabut hak akses Administrator dari ${adm.fullName} (${adm.schoolName || '-'} · ${adm.email})`,
      });
      setConfirmRevokeAdmin(null);
      setFeedback({
        type: 'ok',
        text: `Hak akses Administrator ${adm.fullName} telah dicabut.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `admins/${adm.uid}`);
    } finally {
      setFormBusy(false);
    }
  };

  // ============================================================================
  // MENU 2: DATA SISWA & PEMBERIAN TOKEN MASUK SISWA
  // ============================================================================
  if (activeSubTab === 'students') {
    const studentAttempts = historyRow
      ? attempts
          .filter(
            (a) =>
              a.studentUid === historyRow.id ||
              a.participantNumber === historyRow.participantNumber
          )
          .sort(
            (a, b) =>
              (b.startedAt?.toMillis?.() || 0) - (a.startedAt?.toMillis?.() || 0)
          )
      : [];

    const pendingTokenCount = Math.max(0, sortedStudents.length - readyToLoginCount);

    return (
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Pendataan Nama Siswa &amp; Pemberian Token Masuk
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Siswa <strong>hanya dapat masuk</strong> apabila Admin sudah mendata <strong>Nama Lengkap Siswa</strong> di bawah ini dan memberikan <strong>Token Ujian</strong> terlebih dahulu (tanpa email).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPrintCardsModal(true)}
              disabled={sortedStudents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4 text-slate-500" />
              Cetak Nama &amp; Token
            </button>
            <button
              type="button"
              onClick={() => setShowBulkTokenModal(true)}
              disabled={sortedStudents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-4 h-4 text-sky-700" />
              Beri Token Semua Siswa
            </button>
            <button
              type="button"
              onClick={() => setShowCsvPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-500" />
              Impor CSV
            </button>
            <button
              type="button"
              onClick={openCreateStudent}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Data Siswa Baru
            </button>
          </div>
        </div>

        {/* Summary Readiness Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500">
              1. Total Nama Siswa Didata
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900">
              {sortedStudents.length}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Terdaftar pada direktori peserta Admin
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500">
              2. Siap Masuk (Nama + Token Aktif)
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-emerald-700">
              {readyToLoginCount}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Sudah didata &amp; diberi token aktif
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500">
              3. Belum Diberi Token / Nonaktif
            </div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-amber-700">
              {pendingTokenCount}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Belum dapat masuk ruang ujian
            </div>
          </div>
        </div>

        {/* Classroom Shared Token Option */}
        <TokenManagerCard
          tokens={tokens}
          schoolName={isSuperAdmin ? selectedSchoolFilter || 'ALL' : adminSchoolName}
        />

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

        {showCsvPanel && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Impor Data Siswa dari CSV (Tanpa Email)
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Format 3 kolom otomatis mengisi sekolah Anda (atau 4–5 kolom):{' '}
                  <code className="font-mono-tabular bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">
                    nomor_peserta,nama_lengkap,kelas[,sekolah,token]
                  </code>
                </p>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                Pilih File .CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileRead}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`nomor_peserta,nama_lengkap,kelas\n06-001,Andi Pratama,VI-A\n06-002,Siti Rahmawati,VI-A`}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={csvAutoIssueToken}
                  onChange={(e) => setCsvAutoIssueToken(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  Langsung buatkan &amp; aktifkan <strong>Token Unik otomatis</strong> untuk setiap siswa yang diimpor
                </span>
              </label>
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCsvPanel(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={csvBusy}
                  onClick={handleBulkCsvImport}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {csvBusy ? 'Memproses Impor...' : 'Simpan Data CSV'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama siswa, nomor peserta, sekolah, atau kode token..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={tokenFilter}
              onChange={(e) =>
                setTokenFilter(e.target.value as 'ALL' | 'READY' | 'PENDING')
              }
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">Semua Status Token</option>
              <option value="READY">Siap Masuk ({readyToLoginCount})</option>
              <option value="PENDING">Belum Ada Token ({pendingTokenCount})</option>
            </select>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">Semua Kelas ({sortedStudents.length})</option>
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  Kelas {cls}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Student Roster & Token Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">No</th>
                  <th className="py-3 px-4">Nama Lengkap Siswa</th>
                  <th className="py-3 px-4">Nomor Peserta</th>
                  <th className="py-3 px-4">Kelas · Sekolah</th>
                  <th className="py-3 px-4">Token Masuk Siswa</th>
                  <th className="py-3 px-4">Status Masuk</th>
                  <th className="py-3 px-4 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                      Belum ada data siswa yang cocok. Klik <strong>Data Siswa Baru</strong> atau <strong>Impor CSV</strong> untuk mendata nama siswa dan memberikan token.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((row, idx) => {
                    const tokenInfo = getEffectiveStudentTokenInfo(row);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono-tabular text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{row.fullName}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Tanpa email · wajib sesuai saat login
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular font-medium text-slate-800">
                          {row.participantNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          <span className="font-medium text-slate-900">{row.className}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-600">{row.schoolName}</span>
                        </td>
                        <td className="py-3 px-4">
                          {tokenInfo.ready ? (
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-mono-tabular font-bold tracking-widest text-slate-900">
                                  {tokenInfo.code}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {tokenInfo.sourceLabel}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyStudentCredential(row, tokenInfo.code)
                                }
                                className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                                title="Salin Nama Lengkap dan Token Siswa"
                              >
                                {copiedStudentId === row.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    Tersalin
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    Salin
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-amber-800">
                              {tokenInfo.sourceLabel}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {row.accountStatus !== 'active' ? (
                            <span className="text-xs font-semibold text-red-700">
                              Nonaktif
                            </span>
                          ) : tokenInfo.ready ? (
                            <span className="text-xs font-semibold text-emerald-700">
                              Siap Masuk
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">
                              Menunggu Token
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={formBusy}
                              onClick={() => handleQuickToggleStudentToken(row)}
                              className={`px-2.5 py-1.5 text-xs font-semibold rounded border whitespace-nowrap shrink-0 ${
                                tokenInfo.ready
                                  ? 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100'
                                  : 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                              }`}
                            >
                              {tokenInfo.ready ? 'Tahan Token' : 'Beri Token'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditStudent(row)}
                              className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap shrink-0"
                            >
                              Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryRow(row)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                              title="Riwayat Ujian Siswa"
                            >
                              Riwayat
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmToggleRow(row)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              {row.accountStatus === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteRow(row)}
                              className="p-1.5 text-slate-500 hover:text-red-600 rounded"
                              title="Hapus Data Siswa"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add / Edit Student + Token Issuance Modal */}
        {showStudentModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full p-6 space-y-5 shadow-xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingRow ? 'Ubah Data & Token Siswa' : 'Data Siswa Baru & Pemberian Token'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSaveStudent} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap Siswa (Digunakan Siswa untuk Masuk)
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Ahmad Fauzan"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Siswa tidak dapat mendaftar sendiri — hanya nama yang sudah didata di sini yang dapat masuk.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nomor Peserta / NISN
                    </label>
                    <input
                      type="text"
                      required
                      value={participantNumber}
                      onChange={(e) => setParticipantNumber(e.target.value)}
                      placeholder="Contoh: 06-001"
                      className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kelas
                    </label>
                    <input
                      type="text"
                      required
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="VI-A"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Asal Sekolah Dasar
                  </label>
                  <input
                    type="text"
                    required
                    readOnly={!isSuperAdmin}
                    value={isSuperAdmin ? schoolName : adminSchoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Contoh: SD Negeri 1"
                    className={`w-full px-3 py-2 text-sm border rounded-lg ${
                      isSuperAdmin
                        ? 'border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600'
                        : 'border-slate-200 bg-slate-50 font-semibold text-slate-800'
                    }`}
                  />
                </div>

                {/* Token Issuance Section */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="text-xs font-semibold text-slate-800">
                    Pengaturan Pemberian Token Masuk Siswa
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTokenMode('issue_now');
                        if (!personalTokenCode) {
                          const used = new Set(tokens.map((t) => t.code));
                          setPersonalTokenCode(generateUniqueStudentToken(used));
                        }
                      }}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        tokenMode === 'issue_now'
                          ? 'border-blue-600 bg-blue-50/60 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-semibold">Berikan Token Sekarang</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Siswa langsung dapat masuk dengan Nama + Token
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTokenMode('withhold')}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        tokenMode === 'withhold'
                          ? 'border-amber-600 bg-amber-50/60 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-semibold">Data Nama Dulu (Tahan Token)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Siswa belum bisa masuk sampai diberi token
                      </div>
                    </button>
                  </div>

                  {tokenMode === 'issue_now' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Kode Token Khusus Siswa Ini
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={16}
                          value={personalTokenCode}
                          onChange={(e) =>
                            setPersonalTokenCode(
                              e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                            )
                          }
                          placeholder="Contoh: K7M4P9 (atau kosongkan utk Token Kelas)"
                          className="flex-1 px-3 py-2 text-sm font-mono-tabular font-bold uppercase tracking-widest border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const used = new Set(tokens.map((t) => t.code));
                            setPersonalTokenCode(generateUniqueStudentToken(used));
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Acak Kode
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Kode ini khusus milik siswa tersebut. Jika dikosongkan, siswa akan masuk memakai Token Kelas aktif ({activeClassroomToken ? activeClassroomToken.code : 'belum diaktifkan'}).
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowStudentModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={formBusy}
                    className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {formBusy ? 'Menyimpan...' : 'Simpan Data Siswa'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Bulk Issue Unique Tokens Confirmation Modal */}
        {showBulkTokenModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-sky-700 shrink-0" />
                <h3 className="text-base font-bold text-slate-900">
                  Berikan Token Unik untuk Semua Siswa Aktif?
                </h3>
              </div>
              <p className="text-sm text-slate-600">
                Sistem akan memastikan seluruh siswa berstatus aktif memiliki <strong>Token Khusus Siswa</strong> (6 karakter) dan mengaktifkan status token mereka agar siap masuk ruang ujian. Siswa yang sudah memiliki kode token khusus akan tetap memakai kodenya.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBulkTokenModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={formBusy}
                  onClick={handleBulkIssueUniqueTokens}
                  className="px-4 py-2 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {formBusy ? 'Membuat Token...' : 'Ya, Aktifkan Token Semua Siswa'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Printable Student Name & Token Distribution Sheet Modal */}
        {showPrintCardsModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 print:hidden">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Daftar Nama Lengkap &amp; Token Masuk Peserta Ujian
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Bagikan Nama Lengkap dan kode Token ini kepada masing-masing siswa sebelum ujian dimulai.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Cetak Daftar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPrintCardsModal(false)}
                    className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Tutup
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                <div className="text-center border-b border-slate-200 pb-3">
                  <div className="text-base font-bold text-slate-900">
                    DAFTAR NAMA &amp; TOKEN PESERTA — SIMULASI TKA SD CBT ONLINE
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Siswa masuk tanpa email menggunakan Nama Lengkap dan Token Ujian pada daftar berikut
                  </div>
                </div>

                <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 font-semibold text-slate-800">
                      <th className="py-2 px-3 border-r border-slate-300">No</th>
                      <th className="py-2 px-3 border-r border-slate-300">Nomor Peserta</th>
                      <th className="py-2 px-3 border-r border-slate-300">
                        Nama Lengkap Siswa (Ketik Sesuai Saat Masuk)
                      </th>
                      <th className="py-2 px-3 border-r border-slate-300">Kelas</th>
                      <th className="py-2 px-3">Token Masuk Ujian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {filteredStudents.map((stu, i) => {
                      const info = getEffectiveStudentTokenInfo(stu);
                      return (
                        <tr key={stu.id}>
                          <td className="py-2 px-3 border-r border-slate-300 font-mono-tabular">
                            {i + 1}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-300 font-mono-tabular">
                            {stu.participantNumber}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-300 font-semibold text-slate-900">
                            {stu.fullName}
                          </td>
                          <td className="py-2 px-3 border-r border-slate-300">
                            {stu.className}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular font-bold tracking-widest text-slate-900">
                            {info.ready ? info.code : 'BELUM DIBERI TOKEN'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Activate / Deactivate Modal */}
        {confirmToggleRow && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3">
                {confirmToggleRow.accountStatus === 'active' ? (
                  <UserX className="w-5 h-5 text-red-600 shrink-0" />
                ) : (
                  <UserCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                )}
                <h3 className="text-base font-bold text-slate-900">
                  {confirmToggleRow.accountStatus === 'active'
                    ? 'Nonaktifkan Akses Peserta?'
                    : 'Aktifkan Kembali Akses Peserta?'}
                </h3>
              </div>
              <p className="text-sm text-slate-600">
                {confirmToggleRow.accountStatus === 'active'
                  ? `Siswa ${confirmToggleRow.fullName} (${confirmToggleRow.participantNumber}) tidak akan dapat masuk atau melanjutkan ujian selama berstatus nonaktif.`
                  : `Siswa ${confirmToggleRow.fullName} (${confirmToggleRow.participantNumber}) akan diizinkan kembali masuk apabila memiliki Token Ujian aktif.`}
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmToggleRow(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={formBusy}
                  onClick={() => handleToggleAccountStatus(confirmToggleRow)}
                  className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0 ${
                    confirmToggleRow.accountStatus === 'active'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {formBusy
                    ? 'Memproses...'
                    : confirmToggleRow.accountStatus === 'active'
                    ? 'Ya, Nonaktifkan'
                    : 'Ya, Aktifkan'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Delete Modal */}
        {confirmDeleteRow && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Hapus Data Siswa Secara Permanen?
              </h3>
              <p className="text-sm text-slate-600">
                Data siswa <strong>{confirmDeleteRow.fullName}</strong> (
                {confirmDeleteRow.participantNumber}) beserta token khususnya akan dihapus dari daftar peserta. Siswa yang dihapus tidak dapat masuk ke aplikasi.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteRow(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={formBusy}
                  onClick={() => handleDeleteStudent(confirmDeleteRow)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {formBusy ? 'Menghapus...' : 'Hapus Data Siswa'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Student Exam History Modal */}
        {historyRow && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                    <History className="w-4 h-4 text-blue-600" />
                    Riwayat Ujian — {historyRow.fullName}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 font-mono-tabular">
                    Nomor Peserta: {historyRow.participantNumber} · Kelas {historyRow.className} ·{' '}
                    {historyRow.schoolName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryRow(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {studentAttempts.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500 border border-slate-200 rounded-lg bg-slate-50">
                  Siswa ini belum memulai atau menyelesaikan sesi ujian apa pun.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Nama Ujian</th>
                        <th className="py-2.5 px-3">Mulai</th>
                        <th className="py-2.5 px-3">Dijawab</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Nilai Terpublikasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {studentAttempts.map((att) => (
                        <tr key={att.id}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {att.examTitle}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-600 font-mono-tabular">
                            {formatTimestamp(att.startedAt)}
                          </td>
                          <td className="py-2.5 px-3 font-mono-tabular text-slate-700">
                            {att.answeredCount}/{att.totalQuestions}
                          </td>
                          <td className="py-2.5 px-3 text-xs">
                            {att.status === 'in_progress'
                              ? 'Sedang Mengerjakan'
                              : att.status === 'expired_submitted'
                              ? 'Waktu Habis (Terkirim)'
                              : 'Selesai Dikumpulkan'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-slate-900">
                            {att.scorePublished
                              ? att.publishedFinalScore.toFixed(2)
                              : 'Belum Dipublikasikan'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setHistoryRow(null)}
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
  // MENU 13: PENGATURAN AKUN, PENDAFTARAN SEKOLAH LAIN & HAK AKSES
  // ============================================================================
  if (activeSubTab === 'access_settings') {
    const isCurrentBootstrapped =
      isSuperAdmin ||
      auth.currentUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    const adminUidSet = new Set(admins.map((a) => a.uid));
    const promotableUsers = users.filter(
      (u) =>
        !adminUidSet.has(u.uid) &&
        u.email.toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
    );

    const registrationUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?daftar=admin`
        : '/?daftar=admin';

    const whatsappInviteText = ` Bapak/Ibu Guru & Proktor SD, silakan gunakan aplikasi *SIMULASI TKA SD — CBT ONLINE* (Matematika & Bahasa Indonesia Kelas VI lengkap dengan gambar PDF & koreksi nilai otomatis) untuk sekolah masing-masing.\n\n1. Buka tautan pendaftaran Admin Sekolah:\n${registrationUrl}\n2. Klik *Lanjutkan dengan Akun Google* (belajar.id / Gmail) dan isi Nama Sekolah Dasar.\n3. Data siswa di menu *Data Siswa*, bagikan Token kepada siswa (siswa masuk cukup ketik Nama + Token tanpa email).`.trim();

    const copyTextWithBadge = async (text: string, kind: 'link' | 'wa') => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedShareLink(kind);
        window.setTimeout(() => setCopiedShareLink(null), 2200);
      } catch {
        // ignore clipboard error
      }
    };

    const sortedSchoolAdmins = admins
      .filter((a) => a.email.toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase())
      .sort((a, b) => {
        const rank = (s?: string) => (s === 'pending' ? 0 : s === 'active' || !s ? 1 : 2);
        const rDiff = rank(a.status) - rank(b.status);
        if (rDiff !== 0) return rDiff;
        return (a.schoolName || '').localeCompare(b.schoolName || '', 'id');
      });

    const activeMode = registrationSettings?.mode || 'open';

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Pendaftaran Admin Sekolah Lain, Token &amp; Hak Akses
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Bagikan tautan pendaftaran mandiri agar Guru/Operator dari Sekolah Dasar lain dapat langsung memakai aplikasi ini untuk siswanya masing-masing.
          </p>
        </div>

        {/* Shareable Registration Link & Policy Hub */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700">
                <Share2 className="w-4 h-4" />
                <span>Tautan Pendaftaran Admin Sekolah Baru</span>
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Undang Sekolah Dasar Lain Menggunakan Aplikasi Ini
              </h3>
              <p className="text-sm text-slate-600 max-w-2xl">
                Guru atau Operator SD lain cukup membuka tautan di bawah ini, masuk dengan Google (<code className="font-mono-tabular text-xs">belajar.id</code> / Gmail), lalu mengisi Nama Sekolah Dasar mereka. Data siswa, token, dan rekap nilai tiap sekolah terpisah secara otomatis.
              </p>
            </div>

            <div className="shrink-0">
              <span
                className={`inline-block px-3 py-1.5 rounded border text-xs font-semibold ${
                  activeMode === 'open'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : activeMode === 'approval'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-slate-100 border-slate-300 text-slate-700'
                }`}
              >
                {activeMode === 'open'
                  ? 'Mode Saat Ini: Pendaftaran Terbuka (Otomatis Aktif)'
                  : activeMode === 'approval'
                  ? 'Mode Saat Ini: Persetujuan Admin Utama'
                  : 'Mode Saat Ini: Pendaftaran Ditutup'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-slate-50 font-mono-tabular text-xs text-slate-800 overflow-x-auto">
              <Link2 className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="truncate">{registrationUrl}</span>
            </div>
            <button
              type="button"
              onClick={() => copyTextWithBadge(registrationUrl, 'link')}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              {copiedShareLink === 'link' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Tautan Tersalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Link Pendaftaran
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => copyTextWithBadge(whatsappInviteText, 'wa')}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              {copiedShareLink === 'wa' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Undangan Tersalin
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5 text-slate-600" />
                  Salin Pesan Undangan (WA / Grup KKG)
                </>
              )}
            </button>
          </div>

          {isCurrentBootstrapped && (
            <form
              onSubmit={handleSaveRegistrationSettings}
              className="pt-4 border-t border-slate-200 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setRegModeDraft('open')}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    regModeDraft === 'open'
                      ? 'border-blue-700 bg-blue-50/60 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">
                    1. Pendaftaran Terbuka (Disarankan)
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Guru sekolah lain yang mendaftar dengan Google langsung aktif dan bisa mengelola siswanya tanpa menunggu.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRegModeDraft('approval')}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    regModeDraft === 'approval'
                      ? 'border-amber-600 bg-amber-50/60 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">
                    2. Persetujuan Manual Admin Utama
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Pendaftar baru masuk daftar tunggu sampai Anda mengklik tombol Setujui pada tabel di bawah.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRegModeDraft('closed')}
                  className={`p-3.5 rounded-lg border text-left transition-colors ${
                    regModeDraft === 'closed'
                      ? 'border-slate-900 bg-slate-100 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">
                    3. Tutup Pendaftaran Baru
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Hanya sekolah yang sudah terdaftar saat ini yang dapat masuk ke Dashboard Admin.
                  </p>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Catatan Sambutan pada Halaman Daftar Admin Sekolah
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={welcomeNoteDraft}
                    onChange={(e) => setWelcomeNoteDraft(e.target.value)}
                    placeholder="Pesan singkat bagi guru/proktor SD yang mendaftar..."
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingRegSettings}
                  className="px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  {savingRegSettings ? 'Menyimpan...' : 'Simpan Kebijakan Pendaftaran'}
                </button>
              </div>

              <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-900">
                    Catatan Publikasi ke Vercel / Domain Sendiri:
                  </span>{' '}
                  Jika aplikasi dijalankan di domain baru (mis.{' '}
                  <code className="font-mono-tabular text-slate-900">*.vercel.app</code>), tambahkan
                  domain tersebut 1 kali pada{' '}
                  <strong>Authentication &rarr; Settings &rarr; Authorized domains</strong> di
                  Firebase Console (Proyek:{' '}
                  <code className="font-mono-tabular text-slate-900">{FIREBASE_PROJECT_ID}</code>)
                  agar tombol Daftar/Masuk Google berfungsi.
                </div>
                <a
                  href={FIREBASE_CONSOLE_AUTH_SETTINGS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                >
                  <span>Authorized Domains Firebase</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </form>
          )}
        </div>

        {/* School Admin Self-Profile Card (for non-Super-Admins) */}
        {!isCurrentBootstrapped && myAdminDoc && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-blue-700" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Identitas Sekolah &amp; Profil Admin Saya
                  </h3>
                  <p className="text-xs text-slate-600">
                    Pastikan penulisan Nama Sekolah Dasar konsisten dengan data siswa sekolah Anda.
                  </p>
                </div>
              </div>
              {!editingMyProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setMyFullNameDraft(myAdminDoc.fullName || '');
                    setMySchoolDraft(myAdminDoc.schoolName || adminSchoolName);
                    setMyPositionDraft(myAdminDoc.position || 'Guru Kelas VI / Proktor CBT');
                    setEditingMyProfile(true);
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0"
                >
                  Ubah Profil Sekolah
                </button>
              )}
            </div>

            {editingMyProfile ? (
              <form onSubmit={handleSaveMySchoolProfile} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={myFullNameDraft}
                    onChange={(e) => setMyFullNameDraft(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Sekolah Dasar
                  </label>
                  <input
                    type="text"
                    required
                    value={mySchoolDraft}
                    onChange={(e) => setMySchoolDraft(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jabatan
                  </label>
                  <input
                    type="text"
                    required
                    value={myPositionDraft}
                    onChange={(e) => setMyPositionDraft(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingMyProfile(false)}
                    className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={formBusy}
                    className="px-4 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800"
                  >
                    {formBusy ? 'Menyimpan...' : 'Simpan Profil Sekolah'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm pt-1">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Nama Admin</div>
                  <div className="font-semibold text-slate-900 mt-0.5">{myAdminDoc.fullName}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Nama Sekolah Dasar</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {myAdminDoc.schoolName || adminSchoolName}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Jabatan</div>
                  <div className="font-semibold text-slate-900 mt-0.5">
                    {myAdminDoc.position || 'Admin CBT Sekolah'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <TokenManagerCard
          tokens={tokens}
          schoolName={isSuperAdmin ? selectedSchoolFilter || 'ALL' : adminSchoolName}
        />

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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Primary & Registered School Admins */}
          <div
            className={`${
              isCurrentBootstrapped ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-slate-200 rounded-xl p-5 space-y-4`}
          >
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Daftar Sekolah &amp; Akun Administrator Terdaftar
                </h3>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-slate-500">
                {sortedSchoolAdmins.length + 1} akun
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
              <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Administrator Utama (Pengelola Pusat)
                  </div>
                  <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                    {BOOTSTRAPPED_ADMIN_EMAIL}
                  </div>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded whitespace-nowrap shrink-0 self-start sm:self-center">
                  Admin Utama
                </span>
              </div>

              {sortedSchoolAdmins.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  Belum ada Admin dari sekolah lain yang mendaftar. Bagikan tautan pendaftaran di atas kepada rekan Guru / Operator SD.
                </div>
              ) : (
                sortedSchoolAdmins.map((adm) => {
                  const status = adm.status || 'active';
                  return (
                    <div
                      key={adm.uid}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {adm.fullName}
                          </span>
                          {adm.position && (
                            <span className="text-xs text-slate-500">· {adm.position}</span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-blue-800">
                          {adm.schoolName || 'Sekolah Penyelenggara'}
                        </div>
                        <div className="text-xs text-slate-500 font-mono-tabular">
                          {adm.email}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded border ${
                            status === 'active'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : status === 'pending'
                              ? 'bg-amber-50 border-amber-200 text-amber-900'
                              : 'bg-red-50 border-red-200 text-red-800'
                          }`}
                        >
                          {status === 'active'
                            ? 'Aktif'
                            : status === 'pending'
                            ? 'Menunggu Persetujuan'
                            : 'Nonaktif'}
                        </span>

                        {isCurrentBootstrapped && (
                          <>
                            {status !== 'active' && (
                              <button
                                type="button"
                                disabled={formBusy}
                                onClick={() => handleSetAdminStatus(adm, 'active')}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded whitespace-nowrap shrink-0"
                              >
                                {status === 'pending' ? 'Setujui' : 'Aktifkan'}
                              </button>
                            )}
                            {status === 'active' && (
                              <button
                                type="button"
                                disabled={formBusy}
                                onClick={() => handleSetAdminStatus(adm, 'suspended')}
                                className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 whitespace-nowrap shrink-0"
                              >
                                Nonaktifkan
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={formBusy}
                              onClick={() => setConfirmRevokeAdmin(adm)}
                              className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 whitespace-nowrap shrink-0"
                            >
                              Hapus
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Manual Grant Admin (Super Admin Only) */}
          {isCurrentBootstrapped && (
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <UserCog className="w-5 h-5 text-slate-700" />
                <h3 className="text-base font-bold text-slate-900">
                  Angkat Manual Akun Guru
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Selain lewat tautan <strong>Daftar Admin Sekolah</strong> mandiri, Anda juga dapat mengangkat akun guru yang sudah pernah masuk Google secara manual di sini.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pilih Akun Guru
                  </label>
                  <select
                    value={selectedPromoteUid}
                    onChange={(e) => {
                      const uid = e.target.value;
                      setSelectedPromoteUid(uid);
                      const found = users.find((u) => u.uid === uid);
                      if (found?.schoolName) setPromoteSchoolName(found.schoolName);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">-- Pilih akun guru --</option>
                    {promotableUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Sekolah Dasar
                  </label>
                  <input
                    type="text"
                    value={promoteSchoolName}
                    onChange={(e) => setPromoteSchoolName(e.target.value)}
                    placeholder="Contoh: SD Negeri 2 Harapan"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="button"
                  disabled={!selectedPromoteUid || formBusy}
                  onClick={handlePromoteToAdmin}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {formBusy ? 'Menyimpan...' : 'Berikan Hak Akses Admin'}
                </button>
              </div>
            </div>
          )}
        </div>

        {confirmRevokeAdmin && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Hapus Hak Akses Administrator?
              </h3>
              <p className="text-sm text-slate-600">
                Akun <strong>{confirmRevokeAdmin.fullName}</strong> (
                {confirmRevokeAdmin.schoolName || confirmRevokeAdmin.email}) tidak lagi dapat membuka Dashboard Admin.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmRevokeAdmin(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={formBusy}
                  onClick={() => handleRevokeAdmin(confirmRevokeAdmin)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {formBusy ? 'Memproses...' : 'Ya, Hapus Akses'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // MENU 14: LOG AKTIVITAS (IMMUTABLE AUDIT TRAIL)
  // ============================================================================
  const sortedLogs = [...auditLogs]
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .filter((l) => {
      const q = logSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        l.targetId.toLowerCase().includes(q)
      );
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Log Aktivitas Sistem</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Catatan audit permanen (tidak dapat diubah atau dihapus) atas seluruh tindakan pendataan siswa, pemberian token, verifikasi soal, kunci jawaban, ujian, dan penilaian.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder="Cari aksi, email admin, atau ringkasan..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Pelaksana</th>
                <th className="py-3 px-4">Kode Aksi</th>
                <th className="py-3 px-4">Sasaran</th>
                <th className="py-3 px-4">Ringkasan Aktivitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {sortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                    Belum ada catatan aktivitas yang tersimpan.
                  </td>
                </tr>
              ) : (
                sortedLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600 whitespace-nowrap">
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-800">
                      {log.actorEmail}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono-tabular text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600">
                      {log.targetType}/{log.targetId}
                    </td>
                    <td className="py-3 px-4 text-slate-800">{log.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
