import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  BOOTSTRAPPED_ADMIN_EMAIL,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  UserProfile,
  CbtTokenRecord,
  StudentDirectoryRecord,
  StudentSessionRecord,
  clampStr,
  computeStudentDocId,
  generateRandomSessionId,
  VALIDATION_BOUNDS,
} from '../types/cbt';
import { getAuthoritativeNowMs, syncServerClock } from '../lib/serverClock';

const STUDENT_SESSION_STORAGE_KEY = 'cbt_student_session_id';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  studentSession: StudentSessionRecord | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  authReady: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInStudentWithNameAndToken: (
    studentName: string,
    tokenInput: string
  ) => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithCredentials: (
    emailOrUsername: string,
    pinOrPassword: string
  ) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function translateAuthError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('auth/popup-closed-by-user')) {
    return 'Jendela masuk Google ditutup sebelum proses selesai. Silakan coba lagi.';
  }
  if (msg.includes('auth/popup-blocked')) {
    return 'Jendela pop-up diblokir oleh peramban. Izinkan pop-up untuk situs ini lalu coba lagi.';
  }
  if (
    msg.includes('auth/invalid-credential') ||
    msg.includes('auth/wrong-password') ||
    msg.includes('auth/user-not-found')
  ) {
    return 'Email atau kata sandi administrator tidak sesuai. Periksa kembali identitas Anda.';
  }
  if (msg.includes('auth/operation-not-allowed')) {
    return 'Metode masuk Email/Kata Sandi belum diaktifkan di Firebase Console. Gunakan tombol Masuk Admin dengan Google.';
  }
  if (msg.includes('auth/network-request-failed')) {
    return 'Koneksi internet terputus. Periksa jaringan Anda lalu coba kembali.';
  }
  if (msg.includes('auth/too-many-requests')) {
    return 'Terlalu banyak percobaan masuk yang gagal. Tunggu beberapa saat sebelum mencoba lagi.';
  }
  return 'Gagal memproses autentikasi. Silakan muat ulang halaman dan coba lagi.';
}

function buildStudentProfileFromDirectory(student: StudentDirectoryRecord): UserProfile {
  return {
    uid: student.id,
    fullName: student.fullName,
    participantNumber: student.participantNumber,
    className: student.className,
    schoolName: student.schoolName,
    email: '',
    role: 'student',
    accountStatus: student.accountStatus,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [studentSession, setStudentSession] = useState<StudentSessionRecord | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearSavedStudentSessionLocal = useCallback(() => {
    try {
      localStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setStudentSession(null);
    setProfile(null);
  }, []);

  const restoreSavedStudentSession = useCallback(async (): Promise<boolean> => {
    let savedSessionId: string | null = null;
    try {
      savedSessionId = localStorage.getItem(STUDENT_SESSION_STORAGE_KEY);
    } catch {
      savedSessionId = null;
    }

    if (!savedSessionId || !/^ses_[a-f0-9]{24,76}$/.test(savedSessionId)) {
      clearSavedStudentSessionLocal();
      return false;
    }

    await syncServerClock();
    try {
      const sesSnap = await getDoc(doc(db, 'studentSessions', savedSessionId));
      if (!sesSnap.exists()) {
        clearSavedStudentSessionLocal();
        return false;
      }

      const sesData = sesSnap.data() as StudentSessionRecord;
      const expMs = sesData.expiresAt?.toMillis?.() || 0;
      if (expMs <= getAuthoritativeNowMs()) {
        clearSavedStudentSessionLocal();
        return false;
      }

      const stuSnap = await getDoc(doc(db, 'studentDirectory', sesData.studentId));
      if (!stuSnap.exists()) {
        clearSavedStudentSessionLocal();
        return false;
      }

      const stuData = stuSnap.data() as StudentDirectoryRecord;
      if (stuData.accountStatus !== 'active' || stuData.tokenStatus === 'withheld') {
        clearSavedStudentSessionLocal();
        return false;
      }

      const tokSnap = await getDoc(doc(db, 'cbtTokens', sesData.tokenCode));
      if (!tokSnap.exists()) {
        clearSavedStudentSessionLocal();
        return false;
      }
      const tokData = tokSnap.data() as CbtTokenRecord;
      if (
        !tokData.active ||
        (tokData.scope === 'student' && tokData.studentId !== stuData.id)
      ) {
        clearSavedStudentSessionLocal();
        return false;
      }

      setStudentSession(sesData);
      setProfile(buildStudentProfileFromDirectory(stuData));
      return true;
    } catch {
      // Session expired, student deactivated, or token revoked by Admin
      clearSavedStudentSessionLocal();
      return false;
    }
  }, [clearSavedStudentSessionLocal]);

  const loadAdminIdentity = useCallback(async (fbUser: FirebaseUser): Promise<boolean> => {
    await syncServerClock();
    const email = (fbUser.email || '').trim();
    const isBootstrapped =
      fbUser.emailVerified &&
      email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    let verifiedAdmin = isBootstrapped;
    if (!verifiedAdmin && fbUser.emailVerified) {
      try {
        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        verifiedAdmin = adminSnap.exists();
      } catch {
        verifiedAdmin = false;
      }
    }

    if (!verifiedAdmin) {
      // Register candidate verified teacher profile in /users/{uid} so Primary Admin can grant access in Menu 13
      if (fbUser.emailVerified && email) {
        try {
          const candidateRef = doc(db, 'users', fbUser.uid);
          const candidateSnap = await getDoc(candidateRef);
          if (!candidateSnap.exists()) {
            await setDoc(candidateRef, {
              uid: fbUser.uid,
              fullName: clampStr(fbUser.displayName || email.split('@')[0], VALIDATION_BOUNDS.NAME_MAX_LEN),
              participantNumber: 'CALON-ADMIN',
              className: 'GURU',
              schoolName: 'Sekolah Dasar',
              email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
              role: 'student',
              accountStatus: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // Ignore non-fatal candidate registration error
        }
      }
      setIsAdmin(false);
      setProfile(null);
      return false;
    }

    // Clear any student session if an Admin logs in
    try {
      localStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setStudentSession(null);
    setIsAdmin(true);

    if (isBootstrapped) {
      try {
        const adminDocRef = doc(db, 'admins', fbUser.uid);
        const existingAdminSnap = await getDoc(adminDocRef);
        if (!existingAdminSnap.exists()) {
          await setDoc(adminDocRef, {
            uid: fbUser.uid,
            email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
            fullName: clampStr(
              fbUser.displayName || 'Administrator CBT',
              VALIDATION_BOUNDS.NAME_MAX_LEN
            ),
            createdBy: fbUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('Admin bootstrap sync warning:', err);
      }
    }

    const userPath = `users/${fbUser.uid}`;
    try {
      const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (userSnap.exists()) {
        setProfile(userSnap.data() as UserProfile);
        return true;
      }

      const newAdminProfile = {
        uid: fbUser.uid,
        fullName: clampStr(
          fbUser.displayName || 'Administrator Utama',
          VALIDATION_BOUNDS.NAME_MAX_LEN
        ),
        participantNumber: 'ADMIN-01',
        className: 'ADMIN',
        schoolName: 'Penyelenggara TKA SD',
        email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
        role: 'admin' as const,
        accountStatus: 'active' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', fbUser.uid), newAdminProfile);
      const reloaded = await getDoc(doc(db, 'users', fbUser.uid));
      setProfile(reloaded.data() as UserProfile);
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, userPath);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setIsAdmin(false);
        await restoreSavedStudentSession();
        setAuthReady(true);
        return;
      }
      try {
        const ok = await loadAdminIdentity(fbUser);
        if (!ok) {
          await firebaseSignOut(auth);
          setFirebaseUser(null);
        }
      } catch (err) {
        console.error('Error loading admin identity:', err);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, [loadAdminIdentity, restoreSavedStudentSession]);

  const signInStudentWithNameAndToken = async (
    studentName: string,
    tokenInput: string
  ): Promise<boolean> => {
    setAuthError(null);

    const cleanName = clampStr(
      studentName.replace(/\s+/g, ' '),
      VALIDATION_BOUNDS.NAME_MAX_LEN
    );
    const cleanToken = tokenInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleanName) {
      setAuthError('Masukkan Nama Lengkap Siswa sesuai data pada Admin terlebih dahulu.');
      return false;
    }

    if (
      cleanToken.length < VALIDATION_BOUNDS.TOKEN_MIN_LEN ||
      cleanToken.length > VALIDATION_BOUNDS.TOKEN_MAX_LEN ||
      !VALIDATION_BOUNDS.TOKEN_REGEX.test(cleanToken)
    ) {
      setAuthError(
        'Format Token tidak sesuai. Masukkan kode Token Ujian 4–16 karakter yang diberikan oleh Admin/Pengawas.'
      );
      return false;
    }

    // Ensure no stale Firebase Auth user is active
    if (auth.currentUser) {
      await firebaseSignOut(auth);
      setFirebaseUser(null);
      setIsAdmin(false);
    }

    await syncServerClock();

    // 1. PREREQUISITE A: Admin must have registered the student's name in /studentDirectory/{studentId}
    //    AND granted token access (tokenStatus !== 'withheld').
    const studentId = computeStudentDocId(cleanName);
    let studentRecord: StudentDirectoryRecord | null = null;
    try {
      const stuSnap = await getDoc(doc(db, 'studentDirectory', studentId));
      if (!stuSnap.exists()) {
        setAuthError(
          'Nama siswa belum didata oleh Admin. Siswa hanya dapat masuk apabila Admin sudah mendata nama siswa dan memberikan token terlebih dahulu.'
        );
        return false;
      }
      studentRecord = stuSnap.data() as StudentDirectoryRecord;
      if (studentRecord.accountStatus !== 'active') {
        setAuthError(
          'Data peserta atas nama tersebut sedang dinonaktifkan oleh Admin/Pengawas.'
        );
        return false;
      }
      if (studentRecord.tokenStatus === 'withheld') {
        setAuthError(
          'Nama Anda sudah didata oleh Admin, tetapi Admin belum memberikan/mengaktifkan Token Ujian untuk Anda. Silakan minta Token Ujian kepada Admin/Pengawas.'
        );
        return false;
      }
    } catch {
      setAuthError(
        'Data peserta atas nama tersebut sedang dinonaktifkan oleh Admin/Pengawas.'
      );
      return false;
    }

    // 2. PREREQUISITE B: Admin must have issued & activated the Token in /cbtTokens/{cleanToken}
    //    matching either this specific student (scope === 'student') or the classroom (scope === 'classroom').
    try {
      const tokenSnap = await getDoc(doc(db, 'cbtTokens', cleanToken));
      if (!tokenSnap.exists()) {
        setAuthError(
          'Kode Token tidak sesuai atau belum diaktifkan oleh Admin. Gunakan Token Ujian aktif yang diberikan oleh Admin/Pengawas.'
        );
        return false;
      }
      const tokenData = tokenSnap.data() as CbtTokenRecord;
      if (!tokenData.active) {
        setAuthError(
          'Token Ujian tersebut sedang tidak aktif. Mintalah Token Ujian aktif kepada Admin/Pengawas.'
        );
        return false;
      }
      if (tokenData.scope === 'student' && tokenData.studentId !== studentRecord.id) {
        setAuthError(
          'Kode Token tersebut diberikan untuk peserta lain. Gunakan Token Ujian yang diberikan khusus untuk nama Anda oleh Admin/Pengawas.'
        );
        return false;
      }
    } catch {
      setAuthError(
        'Token Ujian tidak sesuai atau sedang dinonaktifkan oleh Admin/Pengawas.'
      );
      return false;
    }

    // 3. Mint server-verified capability session in /studentSessions/{sessionId}
    const sessionId = generateRandomSessionId();
    const expiresAt = Timestamp.fromMillis(
      getAuthoritativeNowMs() + 18 * 60 * 60 * 1000
    );

    try {
      await setDoc(doc(db, 'studentSessions', sessionId), {
        id: sessionId,
        studentId: studentRecord.id,
        tokenCode: cleanToken,
        fullName: studentRecord.fullName,
        participantNumber: studentRecord.participantNumber,
        className: studentRecord.className,
        schoolName: studentRecord.schoolName,
        createdAt: serverTimestamp(),
        expiresAt,
      });

      const createdSession: StudentSessionRecord = {
        id: sessionId,
        studentId: studentRecord.id,
        tokenCode: cleanToken,
        fullName: studentRecord.fullName,
        participantNumber: studentRecord.participantNumber,
        className: studentRecord.className,
        schoolName: studentRecord.schoolName,
        expiresAt,
      };

      try {
        localStorage.setItem(STUDENT_SESSION_STORAGE_KEY, sessionId);
      } catch {
        // ignore storage quota warning
      }

      setStudentSession(createdSession);
      setProfile(buildStudentProfileFromDirectory(studentRecord));
      setIsAdmin(false);
      return true;
    } catch (err) {
      console.error('Failed creating student capability session:', err);
      setAuthError(
        'Akses ditolak: pastikan Nama Lengkap Anda sudah didata oleh Admin dan Token Ujian yang dimasukkan sudah diaktifkan oleh Admin.'
      );
      return false;
    }
  };

  const signInWithGoogle = async (): Promise<boolean> => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      const ok = await loadAdminIdentity(user);
      if (!ok) {
        await firebaseSignOut(auth);
        setFirebaseUser(null);
        setAuthError(
          `Akun Google (${user.email || 'ini'}) belum terdaftar sebagai Administrator. Akun Anda telah dicatat pada daftar calon pengawas — mintalah Administrator Utama memberikan hak akses pada menu Akun & Hak Akses.`
        );
        return false;
      }
      return true;
    } catch (err) {
      setAuthError(translateAuthError(err));
      return false;
    }
  };

  const signInWithCredentials = async (
    emailOrUsername: string,
    pinOrPassword: string
  ): Promise<boolean> => {
    setAuthError(null);
    const trimmed = emailOrUsername.trim();
    if (!trimmed.includes('@')) {
      setAuthError('Masukkan alamat email resmi Administrator.');
      return false;
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, trimmed, pinOrPassword);
      const ok = await loadAdminIdentity(cred.user);
      if (!ok) {
        await firebaseSignOut(auth);
        setFirebaseUser(null);
        setAuthError('Akun ini tidak memiliki hak akses Administrator.');
        return false;
      }
      return true;
    } catch (err) {
      setAuthError(translateAuthError(err));
      return false;
    }
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      await loadAdminIdentity(firebaseUser);
    } else {
      await restoreSavedStudentSession();
    }
  };

  const signOut = async () => {
    if (studentSession?.id) {
      try {
        await deleteDoc(doc(db, 'studentSessions', studentSession.id));
      } catch {
        // Non-fatal cleanup
      }
    }
    try {
      localStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    if (auth.currentUser) {
      await firebaseSignOut(auth);
    }
    setFirebaseUser(null);
    setStudentSession(null);
    setProfile(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        studentSession,
        profile,
        isAdmin,
        authReady,
        authError,
        clearAuthError: () => setAuthError(null),
        signInStudentWithNameAndToken,
        signInWithGoogle,
        signInWithCredentials,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
