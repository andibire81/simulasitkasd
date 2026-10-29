import React, { useMemo, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  History,
  KeyRound,
  Plus,
  Printer,
  RefreshCw,
  Search,
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
  handleFirestoreError,
  OperationType,
  recordAuditLog,
} from '../../lib/firebase';
import {
  AdminRecord,
  AttemptRecord,
  AuditLogRecord,
  CbtTokenRecord,
  clampStr,
  computeStudentDocId,
  generateRandomTokenCode,
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
  tokens: CbtTokenRecord[];
  admins: AdminRecord[];
  attempts: AttemptRecord[];
  auditLogs: AuditLogRecord[];
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
  tokens,
  admins,
  attempts,
  auditLogs,
}) => {
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

  // Access Settings State
  const [selectedPromoteUid, setSelectedPromoteUid] = useState('');
  const [confirmRevokeAdmin, setConfirmRevokeAdmin] = useState<AdminRecord | null>(null);

  // Audit Log Search
  const [logSearch, setLogSearch] = useState('');

  // Token Lookup Maps
  const activeClassroomToken = useMemo(() => {
    return (
      tokens.find((t) => (!t.scope || t.scope === 'classroom') && t.active) || null
    );
  }, [tokens]);

  const personalTokenByStudentId = useMemo(() => {
    const map = new Map<string, CbtTokenRecord>();
    // Prefer active personal token if multiple exist for same studentId
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
    if (activeClassroomToken) {
      return {
        ready: true,
        code: activeClassroomToken.code,
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

  const openCreateStudent = () => {
    const used = new Set(tokens.map((t) => t.code));
    setEditingRow(null);
    setFullName('');
    setParticipantNumber('');
    setClassName('VI-A');
    setSchoolName('SD Negeri');
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

    const computedId = computeStudentDocId(cleanName);

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
          text: `Kode token "${cleanPersonalCode}" sudah digunakan. Klik Acak Kode Baru untuk membuat kode lain.`,
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
          const duplicate = studentDirectory.find((d) => d.id === computedId);
          if (duplicate) {
            setFeedback({
              type: 'err',
              text: `Nama "${cleanName}" sudah terdaftar pada daftar peserta. Tambahkan pembeda (misal inisial atau kelas) agar nama siswa unik saat masuk.`,
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
            schoolName: cleanSchool,
            tokenStatus: nextTokenStatus,
            accountStatus: editingRow.accountStatus,
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
            schoolName: cleanSchool,
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
        const duplicate = studentDirectory.find((d) => d.id === computedId);
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
          schoolName: cleanSchool,
          tokenStatus: nextTokenStatus,
          accountStatus: 'active',
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
            active: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'cbtTokens', cleanPersonalCode), {
            code: cleanPersonalCode,
            label: clampStr(`Token Peserta CBT (${cleanNum})`, 120),
            scope: 'student',
            studentId: computedId,
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
      if (cols.length < 4) {
        setFeedback({
          type: 'err',
          text: `Baris ke-${i + 1} kurang lengkap. Gunakan format: nomor_peserta,nama_lengkap,kelas,sekolah[,token_opsional]`,
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
      const sch = clampStr(cols[3], VALIDATION_BOUNDS.SCHOOL_MAX_LEN);
      const optToken = (cols[4] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (!pNum || !fName || !normName || !cls || !sch) {
        setFeedback({
          type: 'err',
          text: `Data tidak valid pada baris ke-${i + 1} (${raw}). Pastikan nomor peserta, nama lengkap, kelas, dan sekolah terisi.`,
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

      const id = computeStudentDocId(fName);
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
      const existingById = new Map(studentDirectory.map((d) => [d.id, d]));
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
              active: true,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(doc(db, 'cbtTokens', targetCode), {
              code: targetCode,
              label: clampStr(`Token Peserta CBT (${item.participantNumber})`, 120),
              scope: 'student',
              studentId: item.id,
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

  // Promote existing verified teacher Google account to Admin
  const handlePromoteToAdmin = async () => {
    const targetUser = users.find((u) => u.uid === selectedPromoteUid);
    const currentUid = auth.currentUser?.uid;
    if (!targetUser || !currentUid) return;

    setFormBusy(true);
    setFeedback(null);
    try {
      await setDoc(doc(db, 'admins', targetUser.uid), {
        uid: targetUser.uid,
        email: clampStr(targetUser.email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
        fullName: clampStr(targetUser.fullName, VALIDATION_BOUNDS.NAME_MAX_LEN),
        createdBy: currentUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', targetUser.uid), {
        fullName: targetUser.fullName,
        participantNumber: targetUser.participantNumber,
        className: targetUser.className,
        schoolName: targetUser.schoolName,
        email: targetUser.email,
        role: 'admin',
        accountStatus: 'active',
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        action: 'GRANT_ADMIN_ROLE',
        targetType: 'admins',
        targetId: targetUser.uid,
        summary: `Memberikan hak akses Administrator kepada ${targetUser.fullName} (${targetUser.email})`,
      });
      setSelectedPromoteUid('');
      setFeedback({
        type: 'ok',
        text: `${targetUser.fullName} (${targetUser.email}) kini memiliki hak akses Administrator.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${targetUser.uid}`);
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
        summary: `Mencabut hak akses Administrator dari ${adm.fullName} (${adm.email})`,
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
        <TokenManagerCard tokens={tokens} />

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
                  Format 4 kolom (atau 5 kolom dengan token khusus):{' '}
                  <code className="font-mono-tabular bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">
                    nomor_peserta,nama_lengkap,kelas,sekolah[,token]
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
              placeholder={`nomor_peserta,nama_lengkap,kelas,sekolah\n06-001,Andi Pratama,VI-A,SD Negeri 1\n06-002,Siti Rahmawati,VI-A,SD Negeri 1`}
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
                    Asal Sekolah
                  </label>
                  <input
                    type="text"
                    required
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Contoh: SD Negeri 1"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
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
  // MENU 13: PENGATURAN AKUN & HAK AKSES
  // ============================================================================
  if (activeSubTab === 'access_settings') {
    const isCurrentBootstrapped =
      auth.currentUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    const adminUidSet = new Set(admins.map((a) => a.uid));
    const promotableUsers = users.filter(
      (u) =>
        !adminUidSet.has(u.uid) &&
        u.email.toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
    );

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Pengaturan Akun, Token &amp; Hak Akses
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Kelola Token Kelas serta hak akses Administrator/Pengawas di Cloud Firestore.
          </p>
        </div>

        <TokenManagerCard tokens={tokens} />

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Primary & Registered Admins */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Shield className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-bold text-slate-900">
                Daftar Akun Administrator Resmi
              </h3>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
              <div className="p-3.5 flex items-center justify-between gap-3 bg-slate-50/70">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Administrator Utama (Bootstrapped)
                  </div>
                  <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                    {BOOTSTRAPPED_ADMIN_EMAIL}
                  </div>
                </div>
                <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded whitespace-nowrap shrink-0">
                  Permanen
                </span>
              </div>

              {admins
                .filter(
                  (a) => a.email.toLowerCase() !== BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
                )
                .map((adm) => (
                  <div
                    key={adm.uid}
                    className="p-3.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {adm.fullName}
                      </div>
                      <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                        {adm.email}
                      </div>
                    </div>
                    {isCurrentBootstrapped ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeAdmin(adm)}
                        className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 whitespace-nowrap shrink-0"
                      >
                        Cabut Akses
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">Admin Terdaftar</span>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Grant Admin to Verified Account */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <UserCog className="w-5 h-5 text-slate-700" />
              <h3 className="text-base font-bold text-slate-900">
                Tambahkan Guru / Pengawas sebagai Admin
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              Guru atau pengawas pendamping cukup mencoba masuk satu kali melalui halaman <strong>Masuk Admin dengan Google</strong> agar akunnya tercatat, lalu pilih akunnya di bawah ini untuk diberikan hak akses Administrator.
            </p>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700">
                Pilih Calon Pengawas / Guru
              </label>
              <select
                value={selectedPromoteUid}
                onChange={(e) => setSelectedPromoteUid(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">-- Pilih akun guru yang telah mencoba masuk --</option>
                {promotableUsers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!selectedPromoteUid || formBusy}
                onClick={handlePromoteToAdmin}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                {formBusy ? 'Menyimpan...' : 'Berikan Hak Akses Admin'}
              </button>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-1.5 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                Aturan Akses Siswa &amp; Admin:
              </div>
              <p>
                <strong>Siswa:</strong> Hanya dapat masuk tanpa email apabila Admin sudah mendata <em>Nama Lengkap</em> siswa pada Data Siswa dan memberikan <em>Token Ujian aktif</em>.<br />
                <strong>Admin / Pengawas:</strong> Masuk menggunakan <em>Google Sign-In / Akun Belajar.id</em> terverifikasi.
              </p>
            </div>
          </div>
        </div>

        {confirmRevokeAdmin && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-slate-900">
                Cabut Hak Akses Administrator?
              </h3>
              <p className="text-sm text-slate-600">
                Akun <strong>{confirmRevokeAdmin.fullName}</strong> ({confirmRevokeAdmin.email}) tidak lagi dapat membuka Dashboard Admin maupun melihat kunci jawaban.
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
                  {formBusy ? 'Memproses...' : 'Ya, Cabut Akses'}
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
