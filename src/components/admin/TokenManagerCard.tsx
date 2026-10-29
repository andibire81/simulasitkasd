import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Check, Copy, KeyRound, Power, RefreshCw } from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  recordAuditLog,
} from '../../lib/firebase';
import {
  CbtTokenRecord,
  clampStr,
  generateRandomTokenCode,
  normalizeSchoolName,
  VALIDATION_BOUNDS,
} from '../../types/cbt';

interface TokenManagerCardProps {
  tokens: CbtTokenRecord[];
  schoolName?: string;
  compact?: boolean;
}

export const TokenManagerCard: React.FC<TokenManagerCardProps> = ({
  tokens,
  schoolName,
  compact = false,
}) => {
  const effectiveSchool =
    !schoolName || schoolName === 'ALL' ? 'Semua' : clampStr(schoolName, 120);

  const classroomTokens = tokens.filter((t) => {
    if (t.scope && t.scope !== 'classroom') return false;
    if (effectiveSchool === 'Semua') {
      return (
        !t.schoolName ||
        t.schoolName === 'Semua' ||
        t.schoolName === 'Penyelenggara TKA SD'
      );
    }
    return normalizeSchoolName(t.schoolName || '') === normalizeSchoolName(effectiveSchool);
  });

  const activeToken = classroomTokens.find((t) => t.active) || null;

  const [customTokenInput, setCustomTokenInput] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const generateUniqueClassroomCode = () => {
    const used = new Set(tokens.map((t) => t.code));
    for (let i = 0; i < 40; i++) {
      const candidate = generateRandomTokenCode(6);
      if (!used.has(candidate)) return candidate;
    }
    return generateRandomTokenCode(8);
  };

  const activateTokenCode = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (
      cleanCode.length < VALIDATION_BOUNDS.TOKEN_MIN_LEN ||
      cleanCode.length > VALIDATION_BOUNDS.TOKEN_MAX_LEN ||
      !VALIDATION_BOUNDS.TOKEN_REGEX.test(cleanCode)
    ) {
      setErrorMsg('Token wajib terdiri atas 4 hingga 16 huruf kapital atau angka tanpa spasi.');
      return;
    }

    const adminUid = auth.currentUser?.uid;
    if (!adminUid) return;

    // Prevent collision with a personal student token or another school's classroom token
    const externalCollision = tokens.find(
      (t) =>
        t.code === cleanCode &&
        (t.scope === 'student' || !classroomTokens.some((ct) => ct.code === t.code))
    );
    if (externalCollision) {
      setErrorMsg(
        `Kode ${cleanCode} sedang digunakan pada token peserta atau sekolah lain. Pilih kode lain untuk Token Kelas.`
      );
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      // Deactivate any other currently active classroom token of THIS school only
      for (const t of classroomTokens) {
        if (t.active && t.code !== cleanCode) {
          await updateDoc(doc(db, 'cbtTokens', t.code), {
            label: clampStr(t.label || 'Token Kelas CBT', 120),
            scope: 'classroom',
            studentId: '',
            schoolName: clampStr(t.schoolName || effectiveSchool, 120),
            active: false,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const tokenLabel =
        effectiveSchool === 'Semua'
          ? 'Token Kelas CBT Bersama'
          : clampStr(`Token Kelas — ${effectiveSchool}`, 120);

      const existing = classroomTokens.find((t) => t.code === cleanCode);
      if (existing) {
        await updateDoc(doc(db, 'cbtTokens', cleanCode), {
          label: tokenLabel,
          scope: 'classroom',
          studentId: '',
          schoolName: effectiveSchool,
          active: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'cbtTokens', cleanCode), {
          code: cleanCode,
          label: tokenLabel,
          scope: 'classroom',
          studentId: '',
          schoolName: effectiveSchool,
          active: true,
          createdBy: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await recordAuditLog({
        action: 'ACTIVATE_CLASSROOM_TOKEN',
        targetType: 'cbtTokens',
        targetId: cleanCode,
        summary: `Mengaktifkan Token Kelas CBT (${effectiveSchool}): ${cleanCode}`,
      });

      setCustomTokenInput('');
      setShowCustomForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `cbtTokens/${cleanCode}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivateCurrent = async () => {
    if (!activeToken) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await updateDoc(doc(db, 'cbtTokens', activeToken.code), {
        label: clampStr(activeToken.label || 'Token Kelas CBT', 120),
        scope: 'classroom',
        studentId: '',
        schoolName: clampStr(activeToken.schoolName || effectiveSchool, 120),
        active: false,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        action: 'DEACTIVATE_CLASSROOM_TOKEN',
        targetType: 'cbtTokens',
        targetId: activeToken.code,
        summary: `Menonaktifkan Token Kelas CBT (${effectiveSchool}): ${activeToken.code}`,
      });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `cbtTokens/${activeToken.code}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopyToken = async () => {
    if (!activeToken) return;
    try {
      await navigator.clipboard.writeText(activeToken.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-800">
            <KeyRound className="w-4 h-4" />
            <span>
              Token Kelas Seragam —{' '}
              {effectiveSchool === 'Semua' ? 'Lintas Sekolah' : effectiveSchool}
            </span>
          </div>
          {!compact && (
            <p className="text-sm text-slate-600">
              Siswa <strong>wajib didata namanya terlebih dahulu</strong> pada menu Data Siswa dan berstatus <strong>Token Diberikan</strong>. Anda dapat memakai satu Token Kelas di sini atau memberikan Token Unik tiap siswa pada tabel Data Siswa.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeToken ? (
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-slate-50 border border-slate-300">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Token Kelas Aktif</div>
                <div className="text-xl font-bold font-mono-tabular tracking-widest text-slate-900">
                  {activeToken.code}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyToken}
                className="ml-2 px-2.5 py-1.5 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Salin
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="px-3.5 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
              Token Kelas tidak aktif (Hanya Token Khusus tiap siswa yang berlaku)
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => activateTokenCode(generateUniqueClassroomCode())}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            {activeToken ? 'Acak Token Kelas' : 'Aktifkan Token Kelas'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setShowCustomForm((v) => !v)}
            className="px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Atur Manual
          </button>

          {activeToken && (
            <button
              type="button"
              disabled={busy}
              onClick={handleDeactivateCurrent}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Tutup akses Token Kelas"
            >
              <Power className="w-3.5 h-3.5" />
              Matikan Token Kelas
            </button>
          )}
        </div>
      </div>

      {showCustomForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            activateTokenCode(customTokenInput);
          }}
          className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center gap-2.5"
        >
          <input
            type="text"
            maxLength={16}
            value={customTokenInput}
            onChange={(e) =>
              setCustomTokenInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }
            placeholder="Ketik kode Token Kelas 4-16 karakter (misal: TKA6SD)"
            className="flex-1 max-w-xs px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
          <button
            type="submit"
            disabled={busy || customTokenInput.length < 4}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Simpan &amp; Aktifkan Token Kelas
          </button>
        </form>
      )}

      {errorMsg && (
        <p className="mt-3 text-xs font-medium text-red-700">{errorMsg}</p>
      )}
    </div>
  );
};
