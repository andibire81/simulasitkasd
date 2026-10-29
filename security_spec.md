# Security Specification — SIMULASI TKA SD — CBT ONLINE (Admin Roster + Issued Token Access)

## 1. Data Invariants
1. **Admin Authority (`isAdmin`) & Multi-School Registration**:
   - Only a signed-in user with `request.auth.token.email_verified == true` whose email matches the bootstrapped Super Admin (`andibire81@guru.sd.belajar.id`) or whose `/admins/{uid}` document exists with active status (`!('status' in data) || data.status == 'active'`) has administrative privileges.
   - Verified Google teachers (`isVerifiedUser() && isOwner(adminId)`) can self-register their own `/admins/{uid}` document (`email == request.auth.token.email`, required `schoolName` & `position`) ONLY according to `/adminSettings/registration` controlled exclusively by `isBootstrappedAdmin()`: `'active'` when `mode == 'open'` (default), `'pending'` when `mode == 'approval'`, and denied when `mode == 'closed'`. Non-bootstrapped admins cannot change `status` or modify/delete other admins.
   - School-scoped records (`studentDirectory`, `cbtTokens`, `exams`) restrict updates and deletes to `isBootstrappedAdmin()`, the document creator (`createdBy == request.auth.uid`), or active admins belonging to the same `schoolName`. Official shared TKA question packs (`to1_mtk`, `bindo_2`) cannot be deleted or overwritten once verified except by `isBootstrappedAdmin()`.
2. **Zero Blanket Collection Listing**: EVERY collection in Firestore restricts `allow list` strictly to `isAdmin()`. Unauthenticated/student clients cannot enumerate `/studentDirectory`, `/cbtTokens`, `/studentSessions`, `/questions`, `/answerKeys`, `/exams`, `/attempts`, `/responses`, `/examGrades`, or `/auditLogs`.
3. **Prior Admin Registration & Explicit Token Issuance Gate (`isTokenValidForStudent`)**:
   - Students CANNOT self-register in `/studentDirectory` (`allow create, update, delete` requires `isAdmin()`).
   - Plaintext tokens NEVER reside on `/studentDirectory/{studentId}` so knowing a student's name never reveals their token.
   - A `/studentSessions/{sessionId}` document can ONLY be created (and remains valid for reads, attempts, and responses) if:
     a. `/studentDirectory/{studentId}` exists, `accountStatus == 'active'`, and `tokenStatus == 'issued'`,
     b. `/cbtTokens/{tokenCode}` exists, `active == true`, scope matches, and when `tokenDoc.schoolName` is set, `studentDoc.schoolName == tokenDoc.schoolName`, and
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
