/**
 * Firestore Security Rules Adversarial Test Specification ("Dirty Dozen")
 * Verifies all 12 adversarial payloads in security_spec.md return PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  actor: { uid: string | null; email?: string; email_verified?: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Enumerate classroom or student tokens without Admin credentials',
    actor: { uid: null },
    operation: 'list',
    path: 'cbtTokens',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Scrape student directory list without Admin credentials',
    actor: { uid: null },
    operation: 'list',
    path: 'studentDirectory',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Student attempts self-registration into studentDirectory without Admin',
    actor: { uid: null },
    operation: 'create',
    path: 'studentDirectory/stu_selfregistered0123456789',
    payload: {
      id: 'stu_selfregistered0123456789',
      fullName: 'Siswa Gelap',
      normalizedName: 'siswa gelap',
      participantNumber: '06-999',
      className: 'VI-A',
      schoolName: 'SDN 1',
      tokenStatus: 'issued',
      accountStatus: 'active',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Mint student session when Admin recorded name but withheld token (tokenStatus == withheld)',
    actor: { uid: null },
    operation: 'create',
    path: 'studentSessions/ses_0123456789abcdef0123456789abcdef',
    payload: {
      id: 'ses_0123456789abcdef0123456789abcdef',
      studentId: 'stu_withheld0123456789abcdef',
      tokenCode: 'TKA6SD',
      fullName: 'Budi Santoso',
      participantNumber: '06-001',
      className: 'VI-A',
      schoolName: 'SDN 1',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Mint student session using another student personal token (scope == student, mismatched studentId)',
    actor: { uid: null },
    operation: 'create',
    path: 'studentSessions/ses_abcdef0123456789abcdef0123456789',
    payload: {
      id: 'ses_abcdef0123456789abcdef0123456789',
      studentId: 'stu_budi0123456789abcdef0123',
      tokenCode: 'SITI88',
      fullName: 'Budi Santoso',
      participantNumber: '06-001',
      className: 'VI-A',
      schoolName: 'SDN 1',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Mint student session spoofing className mismatching directory',
    actor: { uid: null },
    operation: 'create',
    path: 'studentSessions/ses_11112222333344445555666677778888',
    payload: {
      id: 'ses_11112222333344445555666677778888',
      studentId: 'stu_abcdef0123456789abcdef01',
      tokenCode: 'TKA6SD',
      fullName: 'Budi Santoso',
      participantNumber: '06-001',
      className: 'VI-Z',
      schoolName: 'SDN 1',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Read confidential answer key without Admin privileges',
    actor: { uid: null },
    operation: 'get',
    path: 'answerKeys/to1_mtk_q01',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Read unpublished exam grade without Admin privileges',
    actor: { uid: null },
    operation: 'get',
    path: 'examGrades/ex1_stu1',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Create attempt for draft or closed exam',
    actor: { uid: null },
    operation: 'create',
    path: 'attempts/ex_draft_stu_abcdef0123456789abcdef01',
    payload: {
      id: 'ex_draft_stu_abcdef0123456789abcdef01',
      examId: 'ex_draft',
      studentUid: 'stu_abcdef0123456789abcdef01',
      sessionId: 'ses_0123456789abcdef0123456789abcdef',
      status: 'in_progress',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Tamper publishedFinalScore on attempt without Admin privileges',
    actor: { uid: null },
    operation: 'update',
    path: 'attempts/ex1_stu_abcdef0123456789abcdef01',
    payload: {
      publishedFinalScore: 100,
      scorePublished: true,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'List responses subcollection to spy on classmate answers',
    actor: { uid: null },
    operation: 'list',
    path: 'attempts/ex1_stu_abcdef0123456789abcdef01/responses',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Write response after Admin revokes student token (tokenStatus == withheld or token deactivated)',
    actor: { uid: null },
    operation: 'update',
    path: 'attempts/ex1_stu1/responses/ses_0123456789abcdef0123456789abcdef_to1_mtk_q01',
    payload: {
      selectedOptionId: 'B',
      clientSequence: 99,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
