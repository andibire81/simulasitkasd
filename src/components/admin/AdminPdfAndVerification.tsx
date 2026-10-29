import React, { useEffect, useState } from 'react';
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  ExternalLink,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  Search,
  Sliders,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, recordAuditLog } from '../../lib/firebase';
import {
  AnswerKeyRecord,
  AssetRecord,
  clampStr,
  ExamRecord,
  QuestionRecord,
  QuestionType,
  sanitizeId,
  VerificationStatus,
} from '../../types/cbt';
import {
  getTo1PagePreviewUrl,
  TO1_MTK_ASSETS,
  TO1_MTK_QUESTIONS,
  TO1_PACK_ID,
  TO1_SOURCE_PDF_NAME,
  TO1_SOURCE_PDF_URL,
} from '../../data/to1MtkSource';
import {
  BINDO2_ASSETS,
  BINDO2_PACK_ID,
  BINDO2_QUESTIONS,
  BINDO2_SOURCE_PDF_NAME,
  BINDO2_SOURCE_PDF_URL,
  getBindo2PagePreviewUrl,
} from '../../data/bindo2Source';
import { syncTo1QuestionsAndAnswerKeysToFirestore } from '../../data/to1MtkAnswerKeys';
import { syncBindo2QuestionsAndAnswerKeysToFirestore } from '../../data/bindo2AnswerKeys';
import { getTrueFalseLabels } from '../../lib/trueFalseLabels';
import { QuestionContentView } from '../QuestionContentView';
import { MathText } from '../MathText';
import { ZoomableImage } from '../ZoomableImage';

interface AdminPdfAndVerificationProps {
  activeSubTab: 'pdf_import' | 'question_bank' | 'verify_questions' | 'verify_images';
  questions: QuestionRecord[];
  assets: AssetRecord[];
  answerKeys: AnswerKeyRecord[];
  exams: ExamRecord[];
  isSuperAdmin?: boolean;
  onSwitchTab: (
    tab: 'pdf_import' | 'question_bank' | 'verify_questions' | 'verify_images'
  ) => void;
}

interface UploadedPdfResult {
  packId: string;
  sourcePdfName: string;
  sourcePdfUrl: string;
  totalPages: number;
  pages: Array<{
    pageNumber: number;
    previewUrl: string;
    width: number;
    height: number;
    lines: string[];
  }>;
}

export const AdminPdfAndVerification: React.FC<AdminPdfAndVerificationProps> = ({
  activeSubTab,
  questions,
  assets,
  answerKeys,
  exams,
  isSuperAdmin = false,
  onSwitchTab,
}) => {
  const isLockedSharedQuestion = (q: QuestionRecord) =>
    !isSuperAdmin &&
    (q.examPackId === TO1_PACK_ID || q.examPackId === BINDO2_PACK_ID) &&
    q.verificationStatus === VerificationStatus.VERIFIED;
  // PDF Import state
  const [to1Status, setTo1Status] = useState<{
    available: boolean;
    renderedPagesCount: number;
    extractedVisualsCount: number;
  } | null>(null);
  const [bindo2Status, setBindo2Status] = useState<{
    available: boolean;
    renderedPagesCount: number;
    extractedVisualsCount: number;
  } | null>(null);
  const [importingTo1, setImportingTo1] = useState(false);
  const [importingBindo2, setImportingBindo2] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [uploadingCustomPdf, setUploadingCustomPdf] = useState(false);
  const [uploadedPdfResult, setUploadedPdfResult] = useState<UploadedPdfResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Manual question draft from uploaded PDF page
  const [draftPageIdx, setDraftPageIdx] = useState(0);
  const [draftNum, setDraftNum] = useState(1);
  const [draftSubject, setDraftSubject] = useState('Matematika');
  const [draftType, setDraftType] = useState<QuestionType>(QuestionType.SINGLE_CHOICE);
  const [draftStem, setDraftStem] = useState('');
  const [draftOptA, setDraftOptA] = useState('');
  const [draftOptB, setDraftOptB] = useState('');
  const [draftOptC, setDraftOptC] = useState('');
  const [draftOptD, setDraftOptD] = useState('');
  const [savingDraftQuestion, setSavingDraftQuestion] = useState(false);

  // Question Bank & Verification subject filters
  const [bankSubjectFilter, setBankSubjectFilter] = useState<string>('ALL');
  const [verifSubjectFilter, setVerifSubjectFilter] = useState<string>('Matematika');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [verifFilter, setVerifFilter] = useState<string>('ALL');
  const [editingQuestion, setEditingQuestion] = useState<QuestionRecord | null>(null);
  const [savingQuestionEdit, setSavingQuestionEdit] = useState(false);

  // Side-by-side Verification state
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');
  const [previewPageNumber, setPreviewPageNumber] = useState<number>(1);
  const [verifNotesInput, setVerifNotesInput] = useState<string>('');
  const [busyVerify, setBusyVerify] = useState(false);
  const [confirmBatchVerify, setConfirmBatchVerify] = useState(false);

  // Image Cropper state (Menu 6)
  const [selectedImageQuestionId, setSelectedImageQuestionId] = useState<string>('');
  const [cropX, setCropX] = useState(10);
  const [cropY, setCropY] = useState(20);
  const [cropW, setCropW] = useState(50);
  const [cropH, setCropH] = useState(30);
  const [croppingBusy, setCroppingBusy] = useState(false);
  const [cropMessage, setCropMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/pdf/to1-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setTo1Status(data);
      })
      .catch(() => null);
    fetch('/api/pdf/bindo2-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setBindo2Status(data);
      })
      .catch(() => null);
  }, []);

  const availableSubjects = Array.from(
    new Set(['Matematika', 'Bahasa Indonesia', ...questions.map((q) => q.subject).filter(Boolean)])
  );

  const sortedQuestions = [...questions].sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return a.originalNumber - b.originalNumber;
  });

  const verifFilteredQuestions = sortedQuestions.filter((q) =>
    verifSubjectFilter === 'ALL' ? true : q.subject === verifSubjectFilter
  );

  useEffect(() => {
    if (verifFilteredQuestions.length > 0) {
      const exists = verifFilteredQuestions.some((q) => q.id === selectedQuestionId);
      if (!exists) {
        const first = verifFilteredQuestions[0];
        setSelectedQuestionId(first.id);
        setPreviewPageNumber(first.sourcePage);
        setVerifNotesInput(first.verificationNotes || '');
      }
    }
  }, [selectedQuestionId, verifSubjectFilter, questions.length]);

  const questionsWithImages = verifFilteredQuestions.filter(
    (q) =>
      q.imageUrls.length > 0 ||
      q.secondaryImageUrls.length > 0 ||
      q.optionHasImages
  );

  useEffect(() => {
    if (questionsWithImages.length > 0) {
      const exists = questionsWithImages.some((q) => q.id === selectedImageQuestionId);
      if (!exists) {
        setSelectedImageQuestionId(questionsWithImages[0].id);
      }
    }
  }, [selectedImageQuestionId, verifSubjectFilter, questionsWithImages.length]);

  // Import built-in TO 1 MTK.pdf + 30 AI-analyzed Answer Keys into Firestore in a single atomic batch
  const handleImportTo1Pdf = async () => {
    setImportingTo1(true);
    setImportFeedback(null);
    try {
      await syncTo1QuestionsAndAnswerKeysToFirestore({
        existingQuestions: questions,
        existingAssets: assets,
        existingAnswerKeys: answerKeys,
        exams,
        forceOverwrite: true,
        forceOverwriteQuestions: true,
        logSummaryPrefix: 'Mengimpor dan menyimpan otomatis',
      });

      setVerifSubjectFilter('Matematika');
      setImportFeedback(
        'Berhasil mengimpor 30 soal asli Matematika, 40 aset visual, serta menyimpan otomatis 30 Kunci Jawaban & Pembahasan AI TO 1 MTK.pdf (SIAP DINILAI).'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'questions');
    } finally {
      setImportingTo1(false);
    }
  };

  // Import built-in B.Indo 2.pdf + 30 AI-analyzed Bahasa Indonesia Answer Keys into Firestore in a single atomic batch
  const handleImportBindo2Pdf = async () => {
    setImportingBindo2(true);
    setImportFeedback(null);
    try {
      await syncBindo2QuestionsAndAnswerKeysToFirestore({
        existingQuestions: questions,
        existingAssets: assets,
        existingAnswerKeys: answerKeys,
        exams,
        forceOverwrite: true,
        forceOverwriteQuestions: true,
        logSummaryPrefix: 'Mengimpor dan menyimpan otomatis',
      });

      setVerifSubjectFilter('Bahasa Indonesia');
      setImportFeedback(
        'Berhasil mengimpor 30 soal asli Bahasa Indonesia, 18 aset visual, serta menyimpan otomatis 30 Kunci Jawaban & Pembahasan AI B.Indo 2.pdf (SIAP DINILAI).'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'questions');
    } finally {
      setImportingBindo2(false);
    }
  };

  // Upload new PDF via Express backend
  const handleCustomPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCustomPdf(true);
    setUploadError(null);
    setUploadedPdfResult(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sesi autentikasi admin tidak ditemukan.');

      const formData = new FormData();
      formData.append('pdfFile', file);

      const resp = await fetch('/api/pdf/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || 'Gagal memproses berkas PDF.');
      }

      const parsed = json as UploadedPdfResult;
      setUploadedPdfResult(parsed);
      setDraftPageIdx(0);
      setDraftStem((parsed.pages[0]?.lines || []).join('\n'));
      await recordAuditLog({
        action: 'UPLOAD_SOURCE_PDF',
        targetType: 'pdfPack',
        targetId: parsed.packId,
        summary: `Mengunggah dan mengekstrak dokumen PDF "${parsed.sourcePdfName}" (${parsed.totalPages} halaman).`,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Gagal mengunggah PDF.');
    } finally {
      setUploadingCustomPdf(false);
      e.target.value = '';
    }
  };

  const handleSaveExtractedDraftQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadedPdfResult) return;
    const pageInfo = uploadedPdfResult.pages[draftPageIdx];
    if (!pageInfo || !draftStem.trim()) return;

    setSavingDraftQuestion(true);
    const qId = sanitizeId(`${uploadedPdfResult.packId}_q${String(draftNum).padStart(2, '0')}`);
    try {
      const options =
        draftType === QuestionType.TRUE_FALSE
          ? []
          : [
              { id: 'A', label: 'A', text: clampStr(draftOptA, 500), imageUrl: '' },
              { id: 'B', label: 'B', text: clampStr(draftOptB, 500), imageUrl: '' },
              { id: 'C', label: 'C', text: clampStr(draftOptC, 500), imageUrl: '' },
              ...(draftOptD.trim()
                ? [{ id: 'D', label: 'D', text: clampStr(draftOptD, 500), imageUrl: '' }]
                : []),
            ];

      const statements =
        draftType === QuestionType.TRUE_FALSE
          ? [
              { id: 'A', label: 'A', text: clampStr(draftOptA, 500), imageUrl: '' },
              { id: 'B', label: 'B', text: clampStr(draftOptB, 500), imageUrl: '' },
              { id: 'C', label: 'C', text: clampStr(draftOptC, 500), imageUrl: '' },
            ]
          : [];

      const mutableDraftFields = {
        examPackId: sanitizeId(uploadedPdfResult.packId).slice(0, 80),
        originalNumber: draftNum,
        displayOrder: draftNum,
        subject: clampStr(draftSubject, 80),
        questionType: draftType,
        stemText: clampStr(draftStem, 8000),
        instructionText:
          draftType === QuestionType.MULTIPLE_CHOICE_COMPLEX
            ? 'Pernyataan benar lebih dari satu.'
            : draftType === QuestionType.TRUE_FALSE
            ? 'Tentukan Benar atau Salah untuk setiap pernyataan.'
            : 'Pilih satu jawaban yang tepat.',
        options,
        statements,
        imageUrls: [],
        postImageText: '',
        secondaryImageUrls: [],
        postSecondaryImageText: '',
        optionHasImages: false,
        lockOptionOrder: draftType === QuestionType.TRUE_FALSE,
        sourcePdfName: clampStr(uploadedPdfResult.sourcePdfName, 200),
        sourcePdfUrl: clampStr(uploadedPdfResult.sourcePdfUrl, 500),
        sourcePage: pageInfo.pageNumber,
        sourcePageEnd: pageInfo.pageNumber,
        sourcePagePreviewUrl: clampStr(pageInfo.previewUrl, 500),
        weight: 1,
        textVerified: false,
        imageVerified: true,
        verificationStatus: VerificationStatus.UNVERIFIED,
        answerKeyVerified: false,
        verificationNotes: 'Hasil ekstraksi unggahan PDF — menunggu pemeriksaan admin.',
        updatedAt: serverTimestamp(),
      };

      const targetRef = doc(db, 'questions', qId);
      if (questions.some((x) => x.id === qId)) {
        await updateDoc(targetRef, mutableDraftFields);
      } else {
        await setDoc(targetRef, {
          id: qId,
          ...mutableDraftFields,
          createdAt: serverTimestamp(),
        });
      }

      await recordAuditLog({
        action: 'SAVE_EXTRACTED_QUESTION',
        targetType: 'question',
        targetId: qId,
        summary: `Menyimpan soal nomor ${draftNum} dari halaman ${pageInfo.pageNumber} (${uploadedPdfResult.sourcePdfName}).`,
      });
      setDraftNum((n) => n + 1);
      setImportFeedback(`Soal nomor ${draftNum} disimpan ke Bank Soal dengan status BELUM TERVERIFIKASI.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `questions/${qId}`);
    } finally {
      setSavingDraftQuestion(false);
    }
  };

  // Verification actions (Menu 5 & 6)
  const handleUpdateQuestionVerification = async (
    q: QuestionRecord,
    nextTextVerified: boolean,
    nextImageVerified: boolean,
    forceNeedsRevision = false
  ) => {
    setBusyVerify(true);
    try {
      const nextStatus = forceNeedsRevision
        ? VerificationStatus.NEEDS_REVISION
        : nextTextVerified && nextImageVerified
        ? VerificationStatus.VERIFIED
        : VerificationStatus.UNVERIFIED;

      await updateDoc(doc(db, 'questions', q.id), {
        textVerified: nextTextVerified,
        imageVerified: nextImageVerified,
        verificationStatus: nextStatus,
        verificationNotes: clampStr(verifNotesInput, 1000),
        updatedAt: serverTimestamp(),
      });

      // Sync associated asset verified flags if imageVerified changed
      const relatedAssets = assets.filter(
        (a) => a.examPackId === q.examPackId && a.questionNumber === q.originalNumber
      );
      if (relatedAssets.length > 0) {
        const b = writeBatch(db);
        for (const a of relatedAssets) {
          b.update(doc(db, 'assets', a.id), {
            verified: nextImageVerified,
            updatedAt: serverTimestamp(),
          });
        }
        await b.commit();
      }

      await recordAuditLog({
        action: 'VERIFY_QUESTION',
        targetType: 'question',
        targetId: q.id,
        summary: `Memperbarui verifikasi soal No. ${q.originalNumber} menjadi ${nextStatus.toUpperCase()}.`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `questions/${q.id}`);
    } finally {
      setBusyVerify(false);
    }
  };

  const handleBatchVerifyAllQuestions = async () => {
    const editableQuestions = sortedQuestions.filter((q) => !isLockedSharedQuestion(q));
    if (editableQuestions.length === 0) {
      setConfirmBatchVerify(false);
      return;
    }
    setBusyVerify(true);
    try {
      const b = writeBatch(db);
      for (const q of editableQuestions) {
        b.update(doc(db, 'questions', q.id), {
          textVerified: true,
          imageVerified: true,
          verificationStatus: VerificationStatus.VERIFIED,
          updatedAt: serverTimestamp(),
        });
      }
      if (isSuperAdmin) {
        for (const a of assets) {
          b.update(doc(db, 'assets', a.id), {
            verified: true,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await b.commit();
      await recordAuditLog({
        action: 'BATCH_VERIFY_ALL_QUESTIONS',
        targetType: 'questions',
        targetId: TO1_PACK_ID,
        summary: `Menandai ${editableQuestions.length} soal telah diperiksa dan TERVERIFIKASI.`,
      });
      setConfirmBatchVerify(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'questions');
    } finally {
      setBusyVerify(false);
    }
  };

  const handleSaveEditedQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;
    setSavingQuestionEdit(true);
    try {
      await updateDoc(doc(db, 'questions', editingQuestion.id), {
        stemText: clampStr(editingQuestion.stemText, 8000),
        postImageText: clampStr(editingQuestion.postImageText, 4000),
        instructionText: clampStr(editingQuestion.instructionText, 500),
        options: editingQuestion.options,
        statements: editingQuestion.statements,
        weight: Math.max(0.5, Math.min(100, Number(editingQuestion.weight) || 1)),
        lockOptionOrder: editingQuestion.lockOptionOrder,
        verificationNotes: clampStr(editingQuestion.verificationNotes, 1000),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        action: 'EDIT_QUESTION_CONTENT',
        targetType: 'question',
        targetId: editingQuestion.id,
        summary: `Memperbarui detail soal nomor ${editingQuestion.originalNumber}.`,
      });
      setEditingQuestion(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `questions/${editingQuestion.id}`);
    } finally {
      setSavingQuestionEdit(false);
    }
  };

  const handleInteractiveReCrop = async (targetQuestion: QuestionRecord) => {
    if (!targetQuestion.sourcePagePreviewUrl) return;
    setCroppingBusy(true);
    setCropMessage(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sesi autentikasi admin tidak ditemukan.');

      const resp = await fetch('/api/pdf/crop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pageImageUrl: targetQuestion.sourcePagePreviewUrl,
          xPercent: cropX,
          yPercent: cropY,
          wPercent: cropW,
          hPercent: cropH,
          targetName: `q${String(targetQuestion.originalNumber).padStart(2, '0')}_recrop`,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Gagal memotong gambar.');

      const newUrl = json.cropUrl as string;
      await updateDoc(doc(db, 'questions', targetQuestion.id), {
        imageUrls: [newUrl],
        imageVerified: false,
        verificationStatus: VerificationStatus.UNVERIFIED,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        action: 'RECROP_QUESTION_IMAGE',
        targetType: 'question',
        targetId: targetQuestion.id,
        summary: `Memperbarui potongan gambar resolusi tinggi soal nomor ${targetQuestion.originalNumber} dari halaman ${targetQuestion.sourcePage}.`,
      });
      setCropMessage(
        'Potongan gambar baru berhasil disimpan. Periksa hasilnya di sebelah kiri lalu tekan Tandai Gambar Terverifikasi.'
      );
    } catch (err) {
      setCropMessage(err instanceof Error ? err.message : 'Gagal memotong ulang gambar.');
    } finally {
      setCroppingBusy(false);
    }
  };

  // ============================================================================
  // RENDER MENU 3: IMPOR PDF
  // ============================================================================
  if (activeSubTab === 'pdf_import') {
    const to1CountInDb = questions.filter((q) => q.examPackId === TO1_PACK_ID).length;
    const bindo2CountInDb = questions.filter((q) => q.examPackId === BINDO2_PACK_ID).length;

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Impor Soal dari Dokumen PDF</h2>
          <p className="text-sm text-slate-600 mt-1">
            Proses dokumen PDF asli menjadi soal terstruktur beserta gambar asli beresolusi tinggi
            untuk mata pelajaran Matematika dan Bahasa Indonesia maupun dokumen PDF tambahan.
          </p>
        </div>

        {importFeedback && (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>{importFeedback}</span>
            <button
              type="button"
              onClick={() => onSwitchTab('verify_questions')}
              className="px-3.5 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 whitespace-nowrap shrink-0"
            >
              Buka Verifikasi Soal
            </button>
          </div>
        )}

        {/* Primary Source PDF Card 1: Matematika — TO 1 MTK.pdf */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-sky-800">Matematika</span>
                <span aria-hidden="true">·</span>
                <span>20 Halaman</span>
                <span aria-hidden="true">·</span>
                <span>30 Soal TKA Kelas VI SD</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{TO1_SOURCE_PDF_NAME}</h3>
              <p className="text-sm text-slate-600">
                Status berkas fisik di server:{' '}
                <strong className="text-slate-900">
                  {to1Status?.available
                    ? `Tersedia (${to1Status.renderedPagesCount} halaman dirender, ${to1Status.extractedVisualsCount} gambar asli diekstrak)`
                    : 'Memeriksa berkas...'}
                </strong>
                {' · '}Tersimpan di Database:{' '}
                <strong className="font-mono-tabular text-slate-900">{to1CountInDb} / 30 soal</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <a
                href={TO1_SOURCE_PDF_URL}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
                Lihat PDF Asli
              </a>
              {!isSuperAdmin && to1CountInDb >= 30 ? (
                <span className="px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-800 whitespace-nowrap shrink-0">
                  ✓ 30 Soal Bersama Siap Dipakai Sekolah Anda
                </span>
              ) : (
                <button
                  type="button"
                  disabled={importingTo1 || importingBindo2}
                  onClick={handleImportTo1Pdf}
                  className="px-5 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  {importingTo1 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Memproses ke Database...
                    </>
                  ) : to1CountInDb > 0 ? (
                    'Sinkronkan Ulang 30 Soal TO 1 MTK.pdf'
                  ) : (
                    'Impor 30 Soal Asli TO 1 MTK.pdf ke Database'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Primary Source PDF Card 2: Bahasa Indonesia — B.Indo 2.pdf */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-blue-800">Bahasa Indonesia</span>
                <span aria-hidden="true">·</span>
                <span>18 Halaman</span>
                <span aria-hidden="true">·</span>
                <span>30 Soal TKA Kelas VI SD</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{BINDO2_SOURCE_PDF_NAME}</h3>
              <p className="text-sm text-slate-600">
                Status berkas fisik di server:{' '}
                <strong className="text-slate-900">
                  {bindo2Status?.available
                    ? `Tersedia (${bindo2Status.renderedPagesCount} halaman dirender, ${bindo2Status.extractedVisualsCount} gambar/bagan/infografis asli diekstrak)`
                    : 'Memeriksa berkas...'}
                </strong>
                {' · '}Tersimpan di Database:{' '}
                <strong className="font-mono-tabular text-slate-900">
                  {bindo2CountInDb} / 30 soal
                </strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <a
                href={BINDO2_SOURCE_PDF_URL}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
                Lihat PDF Asli
              </a>
              {!isSuperAdmin && bindo2CountInDb >= 30 ? (
                <span className="px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-800 whitespace-nowrap shrink-0">
                  ✓ 30 Soal Bersama Siap Dipakai Sekolah Anda
                </span>
              ) : (
                <button
                  type="button"
                  disabled={importingBindo2 || importingTo1}
                  onClick={handleImportBindo2Pdf}
                  className="px-5 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  {importingBindo2 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Memproses ke Database...
                    </>
                  ) : bindo2CountInDb > 0 ? (
                    'Sinkronkan Ulang 30 Soal B.Indo 2.pdf'
                  ) : (
                    'Impor 30 Soal Asli B.Indo 2.pdf ke Database'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Custom PDF Uploader via /api/pdf/upload */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Unggah Dokumen PDF Baru (Ekstraksi Server Resolusi Tinggi)
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Gunakan fitur ini apabila Anda ingin mengunggah paket soal PDF tambahan. Server akan
              merender setiap halaman PDF secara utuh dan mengekstrak baris teks untuk diperiksa
              sebelum disimpan ke Bank Soal.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <label className="px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer inline-flex items-center gap-2 whitespace-nowrap shrink-0">
              <FileUp className="w-4 h-4 text-sky-700" />
              <span>{uploadingCustomPdf ? 'Mengekstrak Halaman PDF...' : 'Pilih Berkas PDF'}</span>
              <input
                type="file"
                accept="application/pdf"
                disabled={uploadingCustomPdf}
                onChange={handleCustomPdfUpload}
                className="hidden"
              />
            </label>
            {uploadingCustomPdf && (
              <span className="text-xs text-slate-600 inline-flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin text-sky-700" />
                Merender halaman PDF pada server...
              </span>
            )}
          </div>

          {uploadError && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
              {uploadError}
            </div>
          )}

          {uploadedPdfResult && (
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">
                    Pratinjau Halaman {uploadedPdfResult.pages[draftPageIdx]?.pageNumber} /{' '}
                    {uploadedPdfResult.totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={draftPageIdx === 0}
                      onClick={() => {
                        const next = Math.max(0, draftPageIdx - 1);
                        setDraftPageIdx(next);
                        setDraftStem((uploadedPdfResult.pages[next]?.lines || []).join('\n'));
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold disabled:opacity-40"
                    >
                      Hal. Sebelumnya
                    </button>
                    <button
                      type="button"
                      disabled={draftPageIdx >= uploadedPdfResult.pages.length - 1}
                      onClick={() => {
                        const next = Math.min(uploadedPdfResult.pages.length - 1, draftPageIdx + 1);
                        setDraftPageIdx(next);
                        setDraftStem((uploadedPdfResult.pages[next]?.lines || []).join('\n'));
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold disabled:opacity-40"
                    >
                      Hal. Berikutnya
                    </button>
                  </div>
                </div>
                {uploadedPdfResult.pages[draftPageIdx] && (
                  <ZoomableImage
                    src={uploadedPdfResult.pages[draftPageIdx].previewUrl}
                    alt={`Halaman ${uploadedPdfResult.pages[draftPageIdx].pageNumber}`}
                    maxHeightClass="max-h-[540px]"
                  />
                )}
              </div>

              <form onSubmit={handleSaveExtractedDraftQuestion} className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900">
                  Simpan Butir Soal dari Halaman Ini ke Bank Soal
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nomor Soal
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={draftNum}
                      onChange={(e) => setDraftNum(Number(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mata Pelajaran
                    </label>
                    <input
                      type="text"
                      list="cbt-subject-options"
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                    <datalist id="cbt-subject-options">
                      <option value="Matematika" />
                      <option value="Bahasa Indonesia" />
                      <option value="Ilmu Pengetahuan Alam dan Sosial" />
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Jenis Soal
                    </label>
                    <select
                      value={draftType}
                      onChange={(e) => setDraftType(e.target.value as QuestionType)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                    >
                      <option value={QuestionType.SINGLE_CHOICE}>Pilihan Ganda</option>
                      <option value={QuestionType.MULTIPLE_CHOICE_COMPLEX}>PG Kompleks</option>
                      <option value={QuestionType.TRUE_FALSE}>Benar / Salah</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Teks Soal (Hasil Ekstraksi Halaman)
                  </label>
                  <textarea
                    rows={5}
                    required
                    value={draftStem}
                    onChange={(e) => setDraftStem(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="Pilihan / Pernyataan A"
                    value={draftOptA}
                    onChange={(e) => setDraftOptA(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Pilihan / Pernyataan B"
                    value={draftOptB}
                    onChange={(e) => setDraftOptB(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Pilihan / Pernyataan C"
                    value={draftOptC}
                    onChange={(e) => setDraftOptC(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {draftType !== QuestionType.TRUE_FALSE && (
                    <input
                      type="text"
                      placeholder="Pilihan D"
                      value={draftOptD}
                      onChange={(e) => setDraftOptD(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  )}
                </div>
                <button
                  type="submit"
                  disabled={savingDraftQuestion}
                  className="px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-60"
                >
                  {savingDraftQuestion ? 'Menyimpan...' : 'Simpan Soal (Status Belum Terverifikasi)'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER MENU 4: BANK SOAL
  // ============================================================================
  if (activeSubTab === 'question_bank') {
    const filtered = sortedQuestions.filter((q) => {
      if (bankSubjectFilter !== 'ALL' && q.subject !== bankSubjectFilter) return false;
      if (typeFilter !== 'ALL' && q.questionType !== typeFilter) return false;
      if (verifFilter !== 'ALL' && q.verificationStatus !== verifFilter) return false;
      if (searchTerm.trim()) {
        const kw = searchTerm.toLowerCase();
        return (
          String(q.originalNumber).includes(kw) ||
          q.subject.toLowerCase().includes(kw) ||
          q.stemText.toLowerCase().includes(kw) ||
          q.postImageText.toLowerCase().includes(kw)
        );
      }
      return true;
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Bank Soal Terstruktur</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Total {sortedQuestions.length} butir soal dalam database ·{' '}
              {sortedQuestions.filter((q) => q.verificationStatus === 'verified').length}{' '}
              terverifikasi ·{' '}
              {sortedQuestions.filter((q) => q.answerKeyVerified).length} kunci siap dinilai.
            </p>
          </div>
          {sortedQuestions.length === 0 && (
            <button
              type="button"
              onClick={() => onSwitchTab('pdf_import')}
              className="px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 whitespace-nowrap shrink-0"
            >
              Impor dari PDF Sekarang
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari nomor, mata pelajaran, atau isi teks soal..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <select
            value={bankSubjectFilter}
            onChange={(e) => setBankSubjectFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white font-medium"
          >
            <option value="ALL">Semua Mata Pelajaran</option>
            {availableSubjects.map((subj) => (
              <option key={subj} value={subj}>
                {subj}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="ALL">Semua Jenis Soal</option>
            <option value={QuestionType.SINGLE_CHOICE}>Pilihan Ganda</option>
            <option value={QuestionType.MULTIPLE_CHOICE_COMPLEX}>Pilihan Ganda Kompleks</option>
            <option value={QuestionType.TRUE_FALSE}>Benar / Salah (Dua Kolom)</option>
          </select>
          <select
            value={verifFilter}
            onChange={(e) => setVerifFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="ALL">Semua Status Verifikasi</option>
            <option value={VerificationStatus.VERIFIED}>Terverifikasi</option>
            <option value={VerificationStatus.UNVERIFIED}>Belum Terverifikasi</option>
            <option value={VerificationStatus.NEEDS_REVISION}>Perlu Perbaikan</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Tidak ada soal yang sesuai dengan filter pencarian.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                  <th className="py-3 px-4 font-semibold w-16">No.</th>
                  <th className="py-3 px-4 font-semibold w-36">Mata Pelajaran</th>
                  <th className="py-3 px-4 font-semibold">Ringkasan Teks Soal</th>
                  <th className="py-3 px-4 font-semibold">Jenis</th>
                  <th className="py-3 px-4 font-semibold">Hal. PDF</th>
                  <th className="py-3 px-4 font-semibold text-right">Bobot</th>
                  <th className="py-3 px-4 font-semibold">Verifikasi Soal</th>
                  <th className="py-3 px-4 font-semibold">Kunci</th>
                  <th className="py-3 px-4 font-semibold text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4 font-mono-tabular font-bold text-slate-900">
                      {q.originalNumber}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-800 whitespace-nowrap">
                      <div>{q.subject}</div>
                      <div className="text-[11px] font-normal text-slate-500">{q.sourcePdfName}</div>
                    </td>
                    <td className="py-3.5 px-4 max-w-md">
                      <p className="line-clamp-2 text-slate-900">
                        <MathText text={q.stemText} />
                      </p>
                      {(q.imageUrls.length > 0 || q.optionHasImages) && (
                        <span className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" /> Memuat gambar asli PDF
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {q.questionType === QuestionType.SINGLE_CHOICE && 'Pilihan Ganda'}
                      {q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX && 'PG Kompleks'}
                      {q.questionType === QuestionType.TRUE_FALSE &&
                        getTrueFalseLabels(q).columnTitle}
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-600 whitespace-nowrap">
                      Hal. {q.sourcePage}
                      {q.sourcePageEnd > q.sourcePage ? `–${q.sourcePageEnd}` : ''}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-tabular">{q.weight}</td>
                    <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                      {q.verificationStatus === VerificationStatus.VERIFIED ? (
                        <span className="text-emerald-700">✓ Terverifikasi</span>
                      ) : q.verificationStatus === VerificationStatus.NEEDS_REVISION ? (
                        <span className="text-red-700">▲ Perlu Perbaikan</span>
                      ) : (
                        <span className="text-amber-700">○ Belum Terverifikasi</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                      {q.answerKeyVerified ? (
                        <span className="text-emerald-700">✓ Siap Dinilai</span>
                      ) : (
                        <span className="text-amber-700">Belum Siap</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setVerifSubjectFilter(q.subject);
                          setSelectedQuestionId(q.id);
                          setPreviewPageNumber(q.sourcePage);
                          setVerifNotesInput(q.verificationNotes || '');
                          onSwitchTab('verify_questions');
                        }}
                        className="px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Periksa
                      </button>
                      {!isLockedSharedQuestion(q) && (
                        <button
                          type="button"
                          onClick={() => setEditingQuestion(JSON.parse(JSON.stringify(q)))}
                          className="px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-sky-800 hover:bg-sky-50"
                        >
                          Edit / Bobot
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Edit Question Modal */}
        {editingQuestion && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <form
              onSubmit={handleSaveEditedQuestion}
              className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">
                  Edit Soal Nomor {editingQuestion.originalNumber}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Tutup
                </button>
              </div>
              <div className="p-6 overflow-y-auto space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Teks Utama Soal
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={editingQuestion.stemText}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, stemText: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                {editingQuestion.imageUrls.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Teks Lanjutan di Bawah Gambar
                    </label>
                    <textarea
                      rows={3}
                      value={editingQuestion.postImageText}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, postImageText: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Bobot Skor Soal
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="100"
                      value={editingQuestion.weight}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          weight: Number(e.target.value) || 1,
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingQuestion.lockOptionOrder}
                        onChange={(e) =>
                          setEditingQuestion({
                            ...editingQuestion,
                            lockOptionOrder: e.target.checked,
                          })
                        }
                      />
                      Kunci urutan pilihan (jangan diacak)
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Catatan Pemeriksaan Admin
                  </label>
                  <input
                    type="text"
                    value={editingQuestion.verificationNotes}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        verificationNotes: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingQuestionEdit}
                  className="px-5 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800"
                >
                  {savingQuestionEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER MENU 5: VERIFIKASI SOAL (SIDE-BY-SIDE DENGAN HALAMAN PDF ASLI)
  // ============================================================================
  if (activeSubTab === 'verify_questions') {
    if (sortedQuestions.length === 0) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
          <FileText className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-900">Belum Ada Soal untuk Diverifikasi</p>
          <p className="text-sm text-slate-600">
            Silakan impor soal dari PDF terlebih dahulu pada menu Impor PDF.
          </p>
          <button
            type="button"
            onClick={() => onSwitchTab('pdf_import')}
            className="px-4 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-semibold"
          >
            Buka Menu Impor PDF
          </button>
        </div>
      );
    }

    const activeQuestionsList =
      verifFilteredQuestions.length > 0 ? verifFilteredQuestions : sortedQuestions;
    const currentQ =
      activeQuestionsList.find((q) => q.id === selectedQuestionId) || activeQuestionsList[0];
    const verifiedTotal = activeQuestionsList.filter(
      (q) => q.verificationStatus === VerificationStatus.VERIFIED
    ).length;

    const resolvedPageImage =
      currentQ.examPackId === TO1_PACK_ID
        ? getTo1PagePreviewUrl(previewPageNumber)
        : currentQ.examPackId === BINDO2_PACK_ID
        ? getBindo2PagePreviewUrl(previewPageNumber)
        : currentQ.sourcePagePreviewUrl;

    const pageNumbersRange = Array.from(
      { length: Math.max(1, currentQ.sourcePageEnd - currentQ.sourcePage + 1) },
      (_, idx) => currentQ.sourcePage + idx
    );

    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Verifikasi Soal terhadap Dokumen PDF Asli
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Bandingkan bunyi soal, bacaan, pilihan jawaban, dan gambar pada tampilan CBT dengan
              halaman PDF sumber ({verifiedTotal}/{activeQuestionsList.length} soal lolos verifikasi).
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {!confirmBatchVerify ? (
              <button
                type="button"
                onClick={() => setConfirmBatchVerify(true)}
                className="px-4 py-2 rounded-lg border border-emerald-600 bg-emerald-50 text-emerald-900 text-xs font-semibold hover:bg-emerald-100 whitespace-nowrap shrink-0"
              >
                Setujui Semua Soal yang Telah Diperiksa ({sortedQuestions.length})
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 px-3 py-1.5 rounded-lg text-xs">
                <span className="font-semibold text-amber-950">
                  Konfirmasi seluruh {sortedQuestions.length} soal & gambar sesuai PDF?
                </span>
                <button
                  type="button"
                  disabled={busyVerify}
                  onClick={handleBatchVerifyAllQuestions}
                  className="px-2.5 py-1 rounded bg-emerald-700 text-white font-semibold"
                >
                  Ya, Verifikasi Semua
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBatchVerify(false)}
                  className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700"
                >
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Subject Tabs + Question Selector Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-600 mr-1">Mata Pelajaran:</span>
            {availableSubjects.map((subj) => {
              const count = sortedQuestions.filter((q) => q.subject === subj).length;
              const isSubjActive = verifSubjectFilter === subj;
              return (
                <button
                  key={subj}
                  type="button"
                  onClick={() => {
                    setVerifSubjectFilter(subj);
                    const firstInSubj = sortedQuestions.find((q) => q.subject === subj);
                    if (firstInSubj) {
                      setSelectedQuestionId(firstInSubj.id);
                      setPreviewPageNumber(firstInSubj.sourcePage);
                      setVerifNotesInput(firstInSubj.verificationNotes || '');
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    isSubjActive
                      ? 'bg-sky-700 border-sky-700 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {subj} ({count})
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {activeQuestionsList.map((q) => {
              const active = q.id === currentQ.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setSelectedQuestionId(q.id);
                    setPreviewPageNumber(q.sourcePage);
                    setVerifNotesInput(q.verificationNotes || '');
                  }}
                  className={`w-10 h-9 rounded-md border text-xs font-mono-tabular font-bold transition-colors ${
                    active
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : q.verificationStatus === VerificationStatus.VERIFIED
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : q.verificationStatus === VerificationStatus.NEEDS_REVISION
                      ? 'bg-red-50 border-red-400 text-red-900'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {q.originalNumber}
                </button>
              );
            })}
          </div>
        </div>

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: CBT Question View + Verification Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <span className="text-base font-bold text-slate-900 font-mono-tabular">
                  Soal Nomor {currentQ.originalNumber}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  ({currentQ.subject} · {currentQ.sourcePdfName} · Hal. {currentQ.sourcePage}
                  {currentQ.sourcePageEnd > currentQ.sourcePage
                    ? `–${currentQ.sourcePageEnd}`
                    : ''}
                  )
                </span>
              </div>
              <span className="text-xs font-semibold">
                {currentQ.verificationStatus === VerificationStatus.VERIFIED ? (
                  <span className="text-emerald-700">✓ TERVERIFIKASI</span>
                ) : currentQ.verificationStatus === VerificationStatus.NEEDS_REVISION ? (
                  <span className="text-red-700">▲ PERLU PERBAIKAN</span>
                ) : (
                  <span className="text-amber-700">○ BELUM TERVERIFIKASI</span>
                )}
              </span>
            </div>

            <QuestionContentView question={currentQ} />

            {/* Options / Statements Preview */}
            {currentQ.questionType !== QuestionType.TRUE_FALSE ? (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500">
                  Pilihan Jawaban ({currentQ.instructionText}):
                </p>
                {currentQ.options.map((o) => (
                  <div
                    key={o.id}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 flex items-start gap-3 text-sm"
                  >
                    <strong className="text-slate-900">{o.label}.</strong>
                    <div>
                      {o.text && <MathText text={o.text} />}
                      {o.imageUrl && (
                        <ZoomableImage
                          src={o.imageUrl}
                          alt={`Pilihan ${o.label}`}
                          maxHeightClass="max-h-[200px]"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500">
                  Pernyataan ({getTrueFalseLabels(currentQ).columnTitle}):
                </p>
                {currentQ.statements.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 text-sm space-y-1.5"
                  >
                    <div>
                      <strong className="mr-2">{s.label}.</strong>
                      <MathText text={s.text} />
                    </div>
                    {s.imageUrl && (
                      <ZoomableImage
                        src={s.imageUrl}
                        alt={`Pernyataan ${s.label}`}
                        maxHeightClass="max-h-[160px]"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Admin Verification Actions */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              {isLockedSharedQuestion(currentQ) ? (
                <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
                  <strong>✓ Paket Soal Utama Bersama:</strong> Soal dan gambar ini telah terverifikasi sesuai dokumen PDF sumber dan siap digunakan langsung oleh seluruh sekolah tanpa perlu diubah.
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Catatan Pemeriksaan Admin (Opsional)
                    </label>
                    <input
                      type="text"
                      value={verifNotesInput}
                      onChange={(e) => setVerifNotesInput(e.target.value)}
                      placeholder="Contoh: Bunyi soal, pecahan, dan gambar sesuai halaman asli."
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={busyVerify}
                      onClick={() =>
                        handleUpdateQuestionVerification(currentQ, true, true, false)
                      }
                      className="px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Tandai Soal &amp; Gambar Terverifikasi
                    </button>
                    <button
                      type="button"
                      disabled={busyVerify}
                      onClick={() =>
                        handleUpdateQuestionVerification(currentQ, false, false, true)
                      }
                      className="px-4 py-2.5 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm font-semibold hover:bg-red-100 disabled:opacity-60 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Tandai Perlu Perbaikan
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Original Source PDF Page Render */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Dokumen PDF Asli — Halaman {previewPageNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  Klik gambar halaman untuk memperbesar hingga 200%.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {pageNumbersRange.length > 1 &&
                  pageNumbersRange.map((pg) => (
                    <button
                      key={pg}
                      type="button"
                      onClick={() => setPreviewPageNumber(pg)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        previewPageNumber === pg
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Hal. {pg}
                    </button>
                  ))}
                <a
                  href={`${currentQ.sourcePdfUrl}#page=${previewPageNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka PDF
                </a>
              </div>
            </div>

            {resolvedPageImage && (
              <ZoomableImage
                src={resolvedPageImage}
                alt={`Halaman ${previewPageNumber} dari ${currentQ.sourcePdfName}`}
                maxHeightClass="max-h-[680px]"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER MENU 6: VERIFIKASI GAMBAR & PEMOTONGAN ULANG RESOLUSI TINGGI
  // ============================================================================
  const currentImgQ =
    questionsWithImages.find((q) => q.id === selectedImageQuestionId) ||
    questionsWithImages[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Verifikasi Gambar Asli & Pemotongan Presisi PDF
        </h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Pastikan seluruh diagram, tabel, piktogram, bangun ruang, dan grafik tidak terpotong,
          tidak buram, serta terhubung ke nomor soal yang tepat.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-600 mr-1">Mata Pelajaran:</span>
        {availableSubjects.map((subj) => {
          const isSubjActive = verifSubjectFilter === subj;
          const imgCount = sortedQuestions.filter(
            (q) =>
              q.subject === subj &&
              (q.imageUrls.length > 0 || q.secondaryImageUrls.length > 0 || q.optionHasImages)
          ).length;
          return (
            <button
              key={subj}
              type="button"
              onClick={() => {
                setVerifSubjectFilter(subj);
                setCropMessage(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                isSubjActive
                  ? 'bg-sky-700 border-sky-700 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {subj} ({imgCount} soal bergambar)
            </button>
          );
        })}
      </div>

      {questionsWithImages.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Belum ada soal bergambar pada mata pelajaran ini di database. Silakan impor PDF terlebih dahulu.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-2">
            {questionsWithImages.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setSelectedImageQuestionId(q.id);
                  setCropMessage(null);
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono-tabular font-semibold transition-colors ${
                  currentImgQ?.id === q.id
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : q.imageVerified
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                    : 'bg-amber-50 border-amber-300 text-amber-900'
                }`}
              >
                Soal {q.originalNumber} {q.imageVerified ? '✓' : '○'}
              </button>
            ))}
          </div>

          {currentImgQ && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Left: Extracted Visuals Inspection */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Gambar Soal Nomor {currentImgQ.originalNumber}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Sumber: {currentImgQ.sourcePdfName} · Halaman {currentImgQ.sourcePage}
                    </p>
                  </div>
                  <span className="text-xs font-semibold">
                    {currentImgQ.imageVerified ? (
                      <span className="text-emerald-700">✓ Gambar Terverifikasi</span>
                    ) : (
                      <span className="text-amber-700">○ Belum Terverifikasi</span>
                    )}
                  </span>
                </div>

                {currentImgQ.imageUrls.map((u, idx) => (
                  <div key={idx}>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Gambar Utama:</p>
                    <ZoomableImage
                      src={u}
                      alt={`Gambar Utama Soal ${currentImgQ.originalNumber}`}
                    />
                  </div>
                ))}

                {currentImgQ.secondaryImageUrls.map((u, idx) => (
                  <div key={idx}>
                    <p className="text-xs font-semibold text-slate-600 mb-1">Gambar Kedua:</p>
                    <ZoomableImage
                      src={u}
                      alt={`Gambar Kedua Soal ${currentImgQ.originalNumber}`}
                    />
                  </div>
                ))}

                {currentImgQ.optionHasImages && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-600">
                      Gambar pada Pilihan / Pernyataan:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {currentImgQ.options
                        .filter((o) => o.imageUrl)
                        .map((o) => (
                          <div key={o.id} className="p-2.5 rounded-lg border border-slate-200">
                            <span className="text-xs font-bold text-slate-800">
                              Pilihan {o.label}
                            </span>
                            <ZoomableImage
                              src={o.imageUrl}
                              alt={`Pilihan ${o.label}`}
                              maxHeightClass="max-h-[160px]"
                            />
                          </div>
                        ))}
                      {currentImgQ.statements
                        .filter((s) => s.imageUrl)
                        .map((s) => (
                          <div key={s.id} className="p-2.5 rounded-lg border border-slate-200">
                            <span className="text-xs font-bold text-slate-800">
                              Pernyataan {s.label}
                            </span>
                            <ZoomableImage
                              src={s.imageUrl}
                              alt={`Pernyataan ${s.label}`}
                              maxHeightClass="max-h-[160px]"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 flex flex-wrap gap-2.5">
                  {isLockedSharedQuestion(currentImgQ) ? (
                    <span className="text-xs font-semibold text-emerald-800">
                      ✓ Gambar Paket Soal Bersama telah terverifikasi dan dikunci agar konsisten bagi seluruh sekolah.
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busyVerify}
                        onClick={() =>
                          handleUpdateQuestionVerification(
                            currentImgQ,
                            currentImgQ.textVerified,
                            true,
                            false
                          )
                        }
                        className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Tandai Gambar Terverifikasi
                      </button>
                      <button
                        type="button"
                        disabled={busyVerify}
                        onClick={() =>
                          handleUpdateQuestionVerification(
                            currentImgQ,
                            currentImgQ.textVerified,
                            false,
                            true
                          )
                        }
                        className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm font-semibold hover:bg-amber-100"
                      >
                        Tandai Belum Terverifikasi
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Right: Source PDF Page + Interactive Precision Re-Cropper */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-sky-700" />
                    Bandingkan Halaman PDF &amp; Potong Ulang Jika Diperlukan
                  </h3>
                  <span className="text-xs font-mono-tabular text-slate-500">
                    Hal. {currentImgQ.sourcePage}
                  </span>
                </div>

                <div className="relative inline-block border border-slate-200 rounded-lg overflow-hidden bg-white max-w-full">
                  <img
                    src={currentImgQ.sourcePagePreviewUrl}
                    alt={`Halaman ${currentImgQ.sourcePage}`}
                    referrerPolicy="no-referrer"
                    className="w-full max-h-[460px] object-contain block"
                  />
                  {!isLockedSharedQuestion(currentImgQ) && (
                    <div
                      style={{
                        left: `${cropX}%`,
                        top: `${cropY}%`,
                        width: `${cropW}%`,
                        height: `${cropH}%`,
                      }}
                      className="absolute border-2 border-sky-600 bg-sky-500/15 pointer-events-none"
                    />
                  )}
                </div>

                {!isLockedSharedQuestion(currentImgQ) && (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <label className="space-y-1">
                        <span className="font-semibold text-slate-700">
                          Posisi Kiri X: {cropX}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={90}
                          value={cropX}
                          onChange={(e) => setCropX(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-slate-700">
                          Posisi Atas Y: {cropY}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={90}
                          value={cropY}
                          onChange={(e) => setCropY(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-slate-700">
                          Lebar Area: {cropW}%
                        </span>
                        <input
                          type="range"
                          min={10}
                          max={100 - cropX}
                          value={cropW}
                          onChange={(e) => setCropW(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-semibold text-slate-700">
                          Tinggi Area: {cropH}%
                        </span>
                        <input
                          type="range"
                          min={8}
                          max={100 - cropY}
                          value={cropH}
                          onChange={(e) => setCropH(Number(e.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>

                    {cropMessage && (
                      <div className="p-3 rounded-lg border border-sky-200 bg-sky-50 text-xs text-sky-900">
                        {cropMessage}
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={croppingBusy}
                      onClick={() => handleInteractiveReCrop(currentImgQ)}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-800 hover:bg-slate-100 inline-flex items-center gap-1.5"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      {croppingBusy
                        ? 'Memotong Resolusi Tinggi...'
                        : 'Gunakan Area Kotak Biru sebagai Gambar Utama'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
