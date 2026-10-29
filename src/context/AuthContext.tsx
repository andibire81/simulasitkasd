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
  onSnapshot,
  setDoc,
  updateDoc,
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
  recordAuditLog,
} from '../lib/firebase';
import {
  AdminRecord,
  AdminRegistrationSettingsRecord,
  UserProfile,
  CbtTokenRecord,
  StudentDirectoryRecord,
  StudentSessionRecord,
  clampStr,
  computeStudentDocId,
  computeStudentDocIdForSchool,
  generateRandomSessionId,
  normalizeStudentName,
  VALIDATION_BOUNDS,
} from '../types/cbt';
import { getAuthoritativeNowMs, syncServerClock } from '../lib/serverClock';

const STUDENT_SESSION_STORAGE_KEY = 'cbt_student_session_id';

export type AdminOnboardingState =
  | 'none'
  | 'needs_registration'
  | 'pending_approval'
  | 'suspended';

const DEFAULT_REGISTRATION_SETTINGS: AdminRegistrationSettingsRecord = {
  id: 'registration',
  mode: 'open',
  welcomeNote:
    'Terbuka bagi Guru Kelas VI, Proktor CBT, dan Operator Sekolah Dasar untuk menyelenggarakan simulasi TKA SD di sekolah masing-masing.',
  updatedBy: BOOTSTRAPPED_ADMIN_EMAIL,
};

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  studentSession: StudentSessionRecord | null;
  profile: UserProfile | null;
  adminRecord: AdminRecord | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  adminOnboardingState: AdminOnboardingState;
  registrationSettings: AdminRegistrationSettingsRecord;
  authReady: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInStudentWithNameAndToken: (
    studentName: string,
    tokenInput: string
  ) => Promise<boolean>;
  signInWithGoogle: () => Promise<'admin' | 'onboarding' | 'error'>;
  completeSchoolAdminRegistration: (params: {
    fullName: string;
    schoolName: string;
    position: string;
  }) => Promise<'active' | 'pending' | null>;
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
    return 'Metode masuk Email/Kata Sandi belum diaktifkan di Firebase Console. Gunakan tombol Masuk/Daftar dengan Google.';
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
  const [adminRecord, setAdminRecord] = useState<AdminRecord | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminOnboardingState, setAdminOnboardingState] =
    useState<AdminOnboardingState>('none');
  const [registrationSettings, setRegistrationSettings] =
    useState<AdminRegistrationSettingsRecord>(DEFAULT_REGISTRATION_SETTINGS);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Subscribe to public registration policy (/adminSettings/registration)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'adminSettings', 'registration'),
      (snap) => {
        if (snap.exists()) {
          setRegistrationSettings(snap.data() as AdminRegistrationSettingsRecord);
        } else {
          setRegistrationSettings(DEFAULT_REGISTRATION_SETTINGS);
        }
      },
      () => {
        setRegistrationSettings(DEFAULT_REGISTRATION_SETTINGS);
      }
    );
    return () => unsub();
  }, []);

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
        (tokData.scope === 'student' && tokData.studentId !== stuData.id) ||
        (tokData.schoolName &&
          tokData.schoolName !== 'Semua' &&
          tokData.schoolName !== stuData.schoolName)
      ) {
        clearSavedStudentSessionLocal();
        return false;
      }

      setStudentSession(sesData);
      setProfile(buildStudentProfileFromDirectory(stuData));
      return true;
    } catch {
      clearSavedStudentSessionLocal();
      return false;
    }
  }, [clearSavedStudentSessionLocal]);

  const loadAdminIdentity = useCallback(
    async (fbUser: FirebaseUser): Promise<'admin' | 'onboarding' | 'unverified'> => {
      await syncServerClock();
      const email = (fbUser.email || '').trim();
      if (!fbUser.emailVerified || !email) {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setAdminRecord(null);
        setAdminOnboardingState('none');
        setProfile(null);
        return 'unverified';
      }

      const bootstrapped =
        email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
      setIsSuperAdmin(bootstrapped);

      let fetchedAdminDoc: AdminRecord | null = null;
      try {
        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        if (adminSnap.exists()) {
          fetchedAdminDoc = adminSnap.data() as AdminRecord;
        }
      } catch {
        fetchedAdminDoc = null;
      }

      const isActiveAdmin =
        bootstrapped ||
        Boolean(
          fetchedAdminDoc &&
            (!fetchedAdminDoc.status || fetchedAdminDoc.status === 'active')
        );

      if (!isActiveAdmin) {
        // Clear student session while teacher completes school onboarding or checks status
        try {
          localStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
        } catch {
          // ignore
        }
        setStudentSession(null);
        setIsAdmin(false);
        setProfile(null);
        setAdminRecord(fetchedAdminDoc);

        if (fetchedAdminDoc?.status === 'pending') {
          setAdminOnboardingState('pending_approval');
        } else if (fetchedAdminDoc?.status === 'suspended') {
          setAdminOnboardingState('suspended');
        } else {
          setAdminOnboardingState('needs_registration');
        }
        return 'onboarding';
      }

      // Active Admin! Clear any student session
      try {
        localStorage.removeItem(STUDENT_SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
      setStudentSession(null);
      setIsAdmin(true);
      setAdminOnboardingState('none');

      if (bootstrapped && !fetchedAdminDoc) {
        try {
          const adminDocRef = doc(db, 'admins', fbUser.uid);
          const payload = {
            uid: fbUser.uid,
            email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
            fullName: clampStr(
              fbUser.displayName || 'Administrator Utama CBT',
              VALIDATION_BOUNDS.NAME_MAX_LEN
            ),
            schoolName: 'Penyelenggara TKA SD',
            position: 'Administrator Utama',
            status: 'active' as const,
            createdBy: fbUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(adminDocRef, payload);
          const createdSnap = await getDoc(adminDocRef);
          if (createdSnap.exists()) {
            fetchedAdminDoc = createdSnap.data() as AdminRecord;
          }
        } catch (err) {
          console.warn('Admin bootstrap sync warning:', err);
        }
      }

      setAdminRecord(fetchedAdminDoc);

      const resolvedSchoolName = clampStr(
        fetchedAdminDoc?.schoolName || 'Penyelenggara TKA SD',
        VALIDATION_BOUNDS.SCHOOL_MAX_LEN
      );
      const resolvedFullName = clampStr(
        fetchedAdminDoc?.fullName || fbUser.displayName || 'Administrator CBT',
        VALIDATION_BOUNDS.NAME_MAX_LEN
      );

      const userPath = `users/${fbUser.uid}`;
      try {
        const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
        if (userSnap.exists()) {
          const uData = userSnap.data() as UserProfile;
          // Ensure role & schoolName stay aligned with active admin record
          if (
            uData.role !== 'admin' ||
            (fetchedAdminDoc?.schoolName && uData.schoolName !== resolvedSchoolName)
          ) {
            await updateDoc(doc(db, 'users', fbUser.uid), {
              fullName: resolvedFullName,
              participantNumber: bootstrapped ? 'ADMIN-01' : 'ADMIN-SEKOLAH',
              className: 'ADMIN',
              schoolName: resolvedSchoolName,
              email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
              role: 'admin',
              accountStatus: 'active',
              updatedAt: serverTimestamp(),
            });
            const refreshed = await getDoc(doc(db, 'users', fbUser.uid));
            setProfile(refreshed.data() as UserProfile);
          } else {
            setProfile(uData);
          }
          return 'admin';
        }

        const newAdminProfile = {
          uid: fbUser.uid,
          fullName: resolvedFullName,
          participantNumber: bootstrapped ? 'ADMIN-01' : 'ADMIN-SEKOLAH',
          className: 'ADMIN',
          schoolName: resolvedSchoolName,
          email: clampStr(email, VALIDATION_BOUNDS.EMAIL_MAX_LEN),
          role: 'admin' as const,
          accountStatus: 'active' as const,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'users', fbUser.uid), newAdminProfile);
        const reloaded = await getDoc(doc(db, 'users', fbUser.uid));
        setProfile(reloaded.data() as UserProfile);
        return 'admin';
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, userPath);
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setAdminRecord(null);
        setAdminOnboardingState('none');
        await restoreSavedStudentSession();
        setAuthReady(true);
        return;
      }
      try {
        const result = await loadAdminIdentity(fbUser);
        if (result === 'unverified') {
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
      setIsSuperAdmin(false);
      setAdminRecord(null);
      setAdminOnboardingState('none');
    }

    await syncServerClock();

    // 1. Inspect the active CBT Token first so we can resolve school-scoped or personal StudentDirectory IDs accurately
    let tokenData: CbtTokenRecord | null = null;
    try {
      const tokenSnap = await getDoc(doc(db, 'cbtTokens', cleanToken));
      if (tokenSnap.exists()) {
        tokenData = tokenSnap.data() as CbtTokenRecord;
      }
    } catch {
      tokenData = null;
    }

    if (!tokenData || !tokenData.active) {
      // Check legacy ID just to provide accurate guidance if student isn't registered yet
      try {
        const legacySnap = await getDoc(
          doc(db, 'studentDirectory', computeStudentDocId(cleanName))
        );
        if (!legacySnap.exists()) {
          setAuthError(
            'Kode Token tidak aktif atau Nama Siswa belum didata oleh Admin Sekolah Anda. Pastikan Guru/Admin sudah mendata nama Anda dan memberikan Token Ujian aktif.'
          );
          return false;
        }
      } catch {
        // ignore
      }
      setAuthError(
        'Kode Token tidak sesuai atau sedang tidak aktif. Mintalah kode Token Ujian aktif kepada Guru/Admin Sekolah Anda.'
      );
      return false;
    }

    // 2. Build deterministic candidate StudentDirectory IDs (supports personal token, school classroom token, and legacy IDs)
    const candidateStudentIds: string[] = [];
    if (tokenData.scope === 'student' && tokenData.studentId) {
      candidateStudentIds.push(tokenData.studentId);
    } else {
      if (tokenData.schoolName && tokenData.schoolName !== 'Semua') {
        candidateStudentIds.push(
          computeStudentDocIdForSchool(cleanName, tokenData.schoolName)
        );
      }
      const legacyId = computeStudentDocId(cleanName);
      if (!candidateStudentIds.includes(legacyId)) {
        candidateStudentIds.push(legacyId);
      }
    }

    let studentRecord: StudentDirectoryRecord | null = null;
    let withheldFound = false;
    let inactiveFound = false;
    let nameMismatchOnPersonalToken = false;

    for (const candidateId of candidateStudentIds) {
      try {
        const stuSnap = await getDoc(doc(db, 'studentDirectory', candidateId));
        if (!stuSnap.exists()) continue;
        const candidateData = stuSnap.data() as StudentDirectoryRecord;

        if (
          normalizeStudentName(candidateData.fullName) !==
          normalizeStudentName(cleanName)
        ) {
          if (tokenData.scope === 'student') {
            nameMismatchOnPersonalToken = true;
          }
          continue;
        }

        if (candidateData.accountStatus !== 'active') {
          inactiveFound = true;
          continue;
        }

        if (candidateData.tokenStatus === 'withheld') {
          withheldFound = true;
          continue;
        }

        if (
          tokenData.schoolName &&
          tokenData.schoolName !== 'Semua' &&
          candidateData.schoolName !== tokenData.schoolName
        ) {
          continue;
        }

        studentRecord = candidateData;
        break;
      } catch {
        // Inactive docs return PERMISSION_DENIED for unauthenticated get
        inactiveFound = true;
      }
    }

    if (!studentRecord) {
      if (nameMismatchOnPersonalToken) {
        setAuthError(
          'Kode Token tersebut diberikan untuk peserta lain, atau ejaan Nama Lengkap belum sesuai dengan pendataan Guru/Admin.'
        );
        return false;
      }
      if (withheldFound) {
        setAuthError(
          'Nama Anda sudah didata oleh Guru/Admin, tetapi akses Token Ujian Anda sedang ditahan. Silakan minta pengaktifan Token kepada Pengawas.'
        );
        return false;
      }
      if (inactiveFound) {
        setAuthError(
          'Data peserta atas nama tersebut sedang dinonaktifkan oleh Guru/Admin Sekolah.'
        );
        return false;
      }
      setAuthError(
        'Nama Lengkap belum ditemukan pada daftar siswa sekolah pemilik Token ini. Pastikan ejaan Nama Lengkap sesuai dengan pendataan Guru/Admin Anda.'
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
        'Akses ditolak: pastikan Nama Lengkap Anda sudah didata oleh Admin dan Token Ujian yang dimasukkan sudah diaktifkan.'
      );
      return false;
    }
  };

  const signInWithGoogle = async (): Promise<'admin' | 'onboarding' | 'error'> => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      if (!user.emailVerified || !user.email) {
        await firebaseSignOut(auth);
        setFirebaseUser(null);
        setAuthError(
          'Akun Google harus memiliki alamat email yang terverifikasi untuk menjadi Admin Sekolah.'
        );
        return 'error';
      }
      const status = await loadAdminIdentity(user);
      if (status === 'admin') return 'admin';
      if (status === 'onboarding') return 'onboarding';
      return 'error';
    } catch (err) {
      setAuthError(translateAuthError(err));
      return 'error';
    }
  };

  const completeSchoolAdminRegistration = async (params: {
    fullName: string;
    schoolName: string;
    position: string;
  }): Promise<'active' | 'pending' | null> => {
    setAuthError(null);
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.emailVerified || !fbUser.email) {
      setAuthError('Silakan masuk dengan Akun Google terverifikasi terlebih dahulu.');
      return null;
    }

    const cleanName = clampStr(
      params.fullName.replace(/\s+/g, ' '),
      VALIDATION_BOUNDS.NAME_MAX_LEN
    );
    const cleanSchool = clampStr(
      params.schoolName.replace(/\s+/g, ' '),
      VALIDATION_BOUNDS.SCHOOL_MAX_LEN
    );
    const cleanPosition = clampStr(
      params.position.replace(/\s+/g, ' ') || 'Guru Kelas VI',
      VALIDATION_BOUNDS.POSITION_MAX_LEN
    );
    const cleanEmail = clampStr(fbUser.email, VALIDATION_BOUNDS.EMAIL_MAX_LEN);

    if (cleanName.length < 2) {
      setAuthError('Masukkan Nama Lengkap Guru / Admin Sekolah dengan benar.');
      return null;
    }
    if (cleanSchool.length < 3) {
      setAuthError('Masukkan Nama Sekolah Dasar dengan lengkap (contoh: SD Negeri 1 ...).');
      return null;
    }

    await syncServerClock();

    // Check latest registration mode from Firestore
    let currentMode = registrationSettings.mode;
    try {
      const regSnap = await getDoc(doc(db, 'adminSettings', 'registration'));
      if (regSnap.exists()) {
        currentMode = (regSnap.data() as AdminRegistrationSettingsRecord).mode;
      } else {
        currentMode = 'open';
      }
    } catch {
      currentMode = 'open';
    }

    if (currentMode === 'closed') {
      setAuthError(
        'Pendaftaran mandiri Admin Sekolah baru sedang ditutup sementara oleh Administrator Utama.'
      );
      return null;
    }

    const targetStatus: 'active' | 'pending' =
      currentMode === 'approval' ? 'pending' : 'active';

    try {
      // 1. Create /admins/{uid} document first so isAdmin() becomes active immediately when mode == 'open'
      await setDoc(doc(db, 'admins', fbUser.uid), {
        uid: fbUser.uid,
        email: cleanEmail,
        fullName: cleanName,
        schoolName: cleanSchool,
        position: cleanPosition,
        status: targetStatus,
        createdBy: fbUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Create or update /users/{uid} profile
      const userRef = doc(db, 'users', fbUser.uid);
      const existingUserSnap = await getDoc(userRef);
      const userPayload = {
        fullName: cleanName,
        participantNumber: targetStatus === 'active' ? 'ADMIN-SEKOLAH' : 'CALON-ADMIN',
        className: targetStatus === 'active' ? 'ADMIN' : 'GURU',
        schoolName: cleanSchool,
        email: cleanEmail,
        role: (targetStatus === 'active' ? 'admin' : 'student') as 'admin' | 'student',
        accountStatus: 'active' as const,
        updatedAt: serverTimestamp(),
      };

      if (existingUserSnap.exists()) {
        await updateDoc(userRef, userPayload);
      } else {
        await setDoc(userRef, {
          uid: fbUser.uid,
          ...userPayload,
          createdAt: serverTimestamp(),
        });
      }

      if (targetStatus === 'active') {
        await recordAuditLog({
          action: 'REGISTER_SCHOOL_ADMIN',
          targetType: 'admins',
          targetId: fbUser.uid,
          summary: `Pendaftaran Admin Sekolah baru: ${cleanName} (${cleanPosition} — ${cleanSchool}, ${cleanEmail})`,
        });
      }

      await loadAdminIdentity(fbUser);
      return targetStatus;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${fbUser.uid}`);
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
      const res = await loadAdminIdentity(cred.user);
      if (res !== 'admin') {
        await firebaseSignOut(auth);
        setFirebaseUser(null);
        setAuthError('Akun ini belum aktif sebagai Administrator.');
        return false;
      }
      return true;
    } catch (err) {
      setAuthError(translateAuthError(err));
      return false;
    }
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await loadAdminIdentity(auth.currentUser);
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
    setAdminRecord(null);
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setAdminOnboardingState('none');
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        studentSession,
        profile,
        adminRecord,
        isAdmin,
        isSuperAdmin,
        adminOnboardingState,
        registrationSettings,
        authReady,
        authError,
        clearAuthError: () => setAuthError(null),
        signInStudentWithNameAndToken,
        signInWithGoogle,
        completeSchoolAdminRegistration,
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
