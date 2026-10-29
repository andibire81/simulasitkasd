import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { clampStr, ExamRecord, ExamStatus, sanitizeId } from '../types/cbt';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'andibire81@guru.sd.belajar.id';

export const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id' &&
    firebaseConfig.apiKey
);

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Mandatory initial Firestore connectivity validation on boot.
 */
async function testConnection() {
  if (!isFirebaseConfigured) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

/**
 * Writes an immutable administrative audit log entry to /auditLogs/{logId}.
 */
export async function recordAuditLog(params: {
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) return;

  const logId = sanitizeId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const path = `auditLogs/${logId}`;
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      id: logId,
      actorUid: user.uid,
      actorEmail: clampStr(user.email, 150),
      action: clampStr(params.action, 100),
      targetType: clampStr(params.targetType, 60),
      targetId: sanitizeId(params.targetId),
      summary: clampStr(params.summary, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Synchronizes /cbtPortal/publishedExams so students signed in via Name + Token
 * can deterministically load active/waiting/finished exams via getDoc without list queries.
 */
export async function syncPublishedExamsPortalIndex(exams: ExamRecord[]): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const publishedIds = exams
    .filter(
      (ex) =>
        ex.status === ExamStatus.WAITING ||
        ex.status === ExamStatus.ACTIVE ||
        ex.status === ExamStatus.FINISHED
    )
    .map((ex) => ex.id)
    .slice(0, 500);

  const path = 'cbtPortal/publishedExams';
  try {
    await setDoc(doc(db, 'cbtPortal', 'publishedExams'), {
      id: 'publishedExams',
      examIds: publishedIds,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
