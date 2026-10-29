import { Timestamp } from 'firebase/firestore';

export enum QuestionType {
  SINGLE_CHOICE = 'single_choice',
  MULTIPLE_CHOICE_COMPLEX = 'multiple_choice_complex',
  TRUE_FALSE = 'true_false',
  UNSUPPORTED = 'unsupported',
}

export enum VerificationStatus {
  UNVERIFIED = 'unverified',
  VERIFIED = 'verified',
  NEEDS_REVISION = 'needs_revision',
}

export enum ExamStatus {
  DRAFT = 'draft',
  WAITING = 'waiting',
  ACTIVE = 'active',
  FINISHED = 'finished',
  ARCHIVED = 'archived',
}

export enum AttemptStatus {
  IN_PROGRESS = 'in_progress',
  SUBMITTED = 'submitted',
  EXPIRED_SUBMITTED = 'expired_submitted',
}

export enum ComplexScoringRule {
  ALL_EXACT = 'all_exact',
  PARTIAL_NO_PENALTY = 'partial_no_penalty',
}

/**
 * Verbatim validation bounds synchronized with firebase-blueprint.json & firestore.rules
 */
export const VALIDATION_BOUNDS = {
  ID_MAX_LEN: 128,
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  TOKEN_MIN_LEN: 4,
  TOKEN_MAX_LEN: 16,
  TOKEN_REGEX: /^[A-Z0-9]+$/,
  NAME_MAX_LEN: 120,
  PARTICIPANT_NUMBER_MAX_LEN: 40,
  CLASS_MAX_LEN: 30,
  SCHOOL_MAX_LEN: 120,
  EMAIL_MAX_LEN: 150,
  STEM_MAX_LEN: 8000,
  INSTRUCTION_MAX_LEN: 500,
  NOTES_MAX_LEN: 1000,
  DISCUSSION_MAX_LEN: 4000,
  TITLE_MAX_LEN: 200,
  DESC_MAX_LEN: 2000,
  URL_MAX_LEN: 500,
  MAX_OPTIONS: 10,
  MAX_QUESTIONS_PER_EXAM: 100,
} as const;

export function sanitizeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, VALIDATION_BOUNDS.ID_MAX_LEN);
  return cleaned || 'item_' + Date.now().toString(36);
}

export function clampStr(val: string, maxLen: number): string {
  return (val || '').trim().slice(0, maxLen);
}

/**
 * Normalizes a student's full name (case-insensitive, collapsed spaces)
 * so students can sign in reliably using their name + classroom token.
 */
export function normalizeStudentName(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, VALIDATION_BOUNDS.NAME_MAX_LEN);
}

/**
 * Synchronous, deterministic SHA-256 hex implementation (UTF-8)
 * ensuring identical student document IDs across all browsers and contexts.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const totalLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Computes the deterministic StudentDirectory document ID from a student's full name.
 */
export function computeStudentDocId(fullName: string): string {
  const norm = normalizeStudentName(fullName);
  return `stu_${sha256Hex(norm).slice(0, 24)}`;
}

/**
 * Generates a 128-bit cryptographic capability session ID (`ses_<32 hex chars>`).
 */
export function generateRandomSessionId(): string {
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `ses_${hex}`;
}

/**
 * Generates an unambiguous uppercase classroom token (avoiding 0/O and 1/I).
 */
export function generateRandomTokenCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[arr[i] % alphabet.length];
  }
  return code;
}

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
  imageUrl: string;
}

export interface TrueFalseStatement {
  id: string;
  label: string;
  text: string;
  imageUrl: string;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  participantNumber: string;
  className: string;
  schoolName: string;
  email: string;
  role: 'student' | 'admin';
  accountStatus: 'active' | 'inactive';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StudentDirectoryRecord {
  id: string;
  fullName: string;
  normalizedName: string;
  participantNumber: string;
  className: string;
  schoolName: string;
  tokenStatus?: 'issued' | 'withheld';
  accountStatus: 'active' | 'inactive';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CbtTokenRecord {
  code: string;
  label: string;
  scope: 'classroom' | 'student';
  studentId: string;
  active: boolean;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CbtPortalRecord {
  id: string;
  examIds: string[];
  updatedAt?: Timestamp;
}

export interface StudentSessionRecord {
  id: string;
  studentId: string;
  tokenCode: string;
  fullName: string;
  participantNumber: string;
  className: string;
  schoolName: string;
  createdAt?: Timestamp;
  expiresAt: Timestamp;
}

export interface AdminRecord {
  uid: string;
  email: string;
  fullName: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface QuestionRecord {
  id: string;
  examPackId: string;
  originalNumber: number;
  displayOrder: number;
  subject: string;
  questionType: QuestionType;
  stemText: string;
  instructionText: string;
  options: QuestionOption[];
  statements: TrueFalseStatement[];
  imageUrls: string[];
  postImageText: string;
  secondaryImageUrls: string[];
  postSecondaryImageText: string;
  optionHasImages: boolean;
  lockOptionOrder: boolean;
  sourcePdfName: string;
  sourcePdfUrl: string;
  sourcePage: number;
  sourcePageEnd: number;
  sourcePagePreviewUrl: string;
  weight: number;
  textVerified: boolean;
  imageVerified: boolean;
  verificationStatus: VerificationStatus;
  answerKeyVerified: boolean;
  verificationNotes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AnswerKeyRecord {
  questionId: string;
  examPackId: string;
  questionType: QuestionType;
  correctOptionId: string;
  correctOptionIds: string[];
  statementKeys: Record<string, boolean>;
  complexScoringRule: ComplexScoringRule;
  wrongScore: number;
  weight: number;
  discussion: string;
  verified: boolean;
  locked: boolean;
  verifiedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ExamRecord {
  id: string;
  title: string;
  description: string;
  subject: string;
  targetClass: string;
  examPackId: string;
  questionIds: string[];
  questionCount: number;
  durationMinutes: number;
  scheduledStart: Timestamp;
  scheduledEnd: Timestamp;
  status: ExamStatus;
  allowRetake: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showDiscussion: boolean;
  publishScore: boolean;
  sourcePdfName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AttemptRecord {
  id: string;
  examId: string;
  examTitle: string;
  subject: string;
  studentUid: string;
  sessionId: string;
  studentName: string;
  participantNumber: string;
  className: string;
  schoolName: string;
  questionOrder: string[];
  totalQuestions: number;
  durationMinutes: number;
  startedAt: Timestamp;
  expiresAt: Timestamp;
  submittedAt: Timestamp;
  status: AttemptStatus;
  answeredCount: number;
  unansweredCount: number;
  flaggedCount: number;
  publishedFinalScore: number;
  publishedRawScore: number;
  publishedMaxScore: number;
  publishedCorrectCount: number;
  publishedWrongCount: number;
  scorePublished: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ResponseRecord {
  attemptId: string;
  questionId: string;
  examId: string;
  studentUid: string;
  sessionId: string;
  questionType: QuestionType;
  selectedOptionId: string;
  selectedOptionIds: string[];
  statementAnswers: Record<string, 'true' | 'false'>;
  flaggedForReview: boolean;
  clientSequence: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ExamGradeRecord {
  attemptId: string;
  examId: string;
  studentUid: string;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  rawScore: number;
  maxScore: number;
  finalScore: number;
  gradingStatus: 'graded_complete' | 'graded_partial' | 'ungraded_missing_keys';
  unverifiedKeyCount: number;
  gradedBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AssetRecord {
  id: string;
  examPackId: string;
  questionNumber: number;
  assetType: 'pdf_source' | 'page_render' | 'question_crop' | 'option_crop';
  url: string;
  sourcePdfName: string;
  sourcePage: number;
  width: number;
  height: number;
  verified: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt?: Timestamp;
}
