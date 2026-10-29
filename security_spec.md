# Security Specification — SIMULASI TKA SD — CBT ONLINE (Admin Roster + Issued Token Access)

## 1. Data Invariants
1. **Admin Authority (`isAdmin`)**: Only a signed-in user with `request.auth.token.email_verified == true` whose email matches the bootstrapped administrator (`andibire81@guru.sd.belajar.id`) or whose UID exists in `/admins/{uid}` has administrative privileges.
2. **Zero Blanket Collection Listing**: EVERY collection in Firestore restricts `allow list` strictly to `isAdmin()`. Unauthenticated/student clients cannot enumerate `/studentDirectory`, `/cbtTokens`, `/studentSessions`, `/questions`, `/answerKeys`, `/exams`, `/attempts`, `/responses`, `/examGrades`, or `/auditLogs`.
3. **Prior Admin Registration & Explicit Token Issuance Gate (`isTokenValidForStudent`)**:
   - Students CANNOT self-register in `/studentDirectory` (`allow create, update, delete: if isAdmin()`).
   - Plaintext tokens NEVER reside on `/studentDirectory/{studentId}` so knowing a student's name never reveals their token.
   - A `/studentSessions/{sessionId}` document can ONLY be created (and remains valid for reads, attempts, and responses) if:
     a. `/studentDirectory/{studentId}` exists, `accountStatus == 'active'`, and `tokenStatus == 'issued'` (Admin has registered the student AND granted token access),
     b. `/cbtTokens/{tokenCode}` exists, `active == true`, and either `scope == 'classroom'` or `(scope == 'student' && studentId == incoming().studentId)`, and
     c. `fullName`, `participantNumber`, `className`, and `schoolName` match the authoritative `/studentDirectory/{studentId}` record.
4. **Confidentiality of Answer Keys & Unpublished Grades**: `/answerKeys/{questionId}` and `/examGrades/{attemptId}` are 100% `isAdmin()` only for all reads and writes.
5. **Capability-Addressed Student Responses & Immediate Revocation**: Each student response document ID must equal `sessionId + '_' + questionId` and match the parent `/attempts/{attemptId}`'s active `sessionId`, `status == 'in_progress'`, `request.time <= expiresAt`, and `isValidActiveSessionForStudent(...)` (which re-verifies `isTokenValidForStudent` on every write so revoking a token or student immediately halts access).
6. **Terminal Attempt Locking & Score Integrity**: Students cannot self-publish scores (`scorePublished == false` on create, untouched on student updates) and cannot modify an attempt or response once `status` transitions out of `'in_progress'` or `request.time > expiresAt`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Enumerate all tokens**: `list /cbtTokens` without `isAdmin()` -> `PERMISSION_DENIED`.
2. **Enumerate student directory**: `list /studentDirectory` without `isAdmin()` -> `PERMISSION_DENIED`.
3. **Self-register unregistered student into directory**: `create /studentDirectory/stu_...` without `isAdmin()` -> `PERMISSION_DENIED`.
4. **Mint student session when Admin has registered name but NOT yet issued token (`tokenStatus == 'withheld'`)**: `create /studentSessions/ses_...` -> `PERMISSION_DENIED`.
5. **Mint student session using another student's personal token (`scope == 'student'`, mismatched `studentId`)**: `create /studentSessions/ses_...` -> `PERMISSION_DENIED`.
6. **Mint student session spoofing className**: `create /studentSessions/ses_...` where `incoming().className != studentDirectory.className` -> `PERMISSION_DENIED`.
7. **Read answer key as student**: `get /answerKeys/to1_mtk_q01` without `isAdmin()` -> `PERMISSION_DENIED`.
8. **Read unpublished grade as student**: `get /examGrades/ex1_stu1` without `isAdmin()` -> `PERMISSION_DENIED`.
9. **Start attempt on draft/closed exam**: `create /attempts/ex1_stu1` when `/exams/ex1.status != 'active'` -> `PERMISSION_DENIED`.
10. **Self-assign publishedFinalScore = 100 on attempt**: `update /attempts/ex1_stu1` modifying `publishedFinalScore` without `isAdmin()` -> `PERMISSION_DENIED`.
11. **Peek classmate's response without knowing their 128-bit `sessionId`**: `list /attempts/ex1_stu1/responses` without `isAdmin()` -> `PERMISSION_DENIED`.
12. **Write response after Admin revokes student token (`tokenStatus == 'withheld'` or `cbtTokens.active == false`)**: `update /attempts/ex1_stu1/responses/ses_..._q01` -> `PERMISSION_DENIED`.
