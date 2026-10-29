import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, Image, Path2D, DOMMatrix } from '@napi-rs/canvas';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

// Polyfill canvas primitives for pdfjs-dist in Node
(globalThis as Record<string, unknown>).DOMMatrix = DOMMatrix;
(globalThis as Record<string, unknown>).Path2D = Path2D;
(globalThis as Record<string, unknown>).Image = Image;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.join(__dirname, 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'))
  : { apiKey: '', projectId: '' };

const BOOTSTRAPPED_ADMIN_EMAIL = 'andibire81@guru.sd.belajar.id';

interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Verifies a Firebase ID Token server-side against Google Identity Toolkit
 * without exposing any secret keys on the client.
 */
async function verifyFirebaseIdToken(req: Request): Promise<VerifiedAuthUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || !firebaseConfig.apiKey) {
    return null;
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      users?: Array<{ localId: string; email?: string; emailVerified?: boolean }>;
    };
    const user = json.users?.[0];
    if (!user || !user.localId) return null;
    return {
      uid: user.localId,
      email: user.email || '',
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

/**
 * Checks whether the verified caller is an authorized Administrator
 * via bootstrapped email or live Firestore REST lookup on /admins/{uid}.
 */
async function verifyAdminRequest(req: Request): Promise<VerifiedAuthUser | null> {
  const user = await verifyFirebaseIdToken(req);
  if (!user || !user.emailVerified) return null;

  if (user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return user;
  }

  // Check /admins/{uid} document via Firestore REST API forwarding caller's Bearer token
  const authHeader = req.headers.authorization || '';
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const projectId = firebaseConfig.projectId;
  if (!projectId) return null;

  try {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(dbId)}/documents/admins/${encodeURIComponent(user.uid)}`;
    const docResp = await fetch(docUrl, {
      headers: { Authorization: authHeader },
    });
    if (docResp.ok) {
      const docJson = (await docResp.json()) as {
        fields?: { status?: { stringValue?: string } };
      };
      const statusVal = docJson.fields?.status?.stringValue;
      if (!statusVal || statusVal === 'active') {
        return user;
      }
    }
  } catch {
    return null;
  }
  return null;
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext: { canvas: ReturnType<typeof createCanvas> }, width: number, height: number) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }
  destroy(canvasAndContext: { canvas: ReturnType<typeof createCanvas> }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

const uploadsRoot = path.join(__dirname, 'public', 'uploads', 'pdf-packs');
fs.mkdirSync(uploadsRoot, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024 },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // 1. Authoritative Server Clock Endpoint for tamper-resistant CBT timer
  app.get('/api/time', (_req: Request, res: Response) => {
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
      serverTimeMs: now,
      iso: new Date(now).toISOString(),
    });
  });

  // 2. Verify Built-in TO 1 MTK.pdf Source & Extracted Assets Status
  app.get('/api/pdf/to1-status', (_req: Request, res: Response) => {
    const pdfFile = path.join(__dirname, 'public', 'assets', 'aistudio', 'TO_1_MTK_e0f5901f.pdf');
    const pagesDir = path.join(__dirname, 'public', 'assets', 'pdf-pages', 'to1-mtk');
    const cropsDir = path.join(__dirname, 'public', 'assets', 'pdf-crops', 'to1-mtk');

    const pdfExists = fs.existsSync(pdfFile);
    const pageFiles = fs.existsSync(pagesDir)
      ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.png'))
      : [];
    const cropFiles = fs.existsSync(cropsDir)
      ? fs.readdirSync(cropsDir).filter((f) => f.endsWith('.png'))
      : [];

    res.json({
      available: pdfExists,
      sourcePdfName: 'TO 1 MTK.pdf',
      sourcePdfUrl: '/assets/aistudio/TO_1_MTK_e0f5901f.pdf',
      renderedPagesCount: pageFiles.length,
      extractedVisualsCount: cropFiles.length,
    });
  });

  // 2b. Verify Built-in B.Indo 2.pdf Source & Extracted Assets Status
  app.get('/api/pdf/bindo2-status', (_req: Request, res: Response) => {
    const pdfFile = path.join(__dirname, 'public', 'assets', 'aistudio', 'B.Indo_2_e376b629.pdf');
    const pagesDir = path.join(__dirname, 'public', 'assets', 'pdf-pages', 'bindo-2');
    const cropsDir = path.join(__dirname, 'public', 'assets', 'pdf-crops', 'bindo-2');

    const pdfExists = fs.existsSync(pdfFile);
    const pageFiles = fs.existsSync(pagesDir)
      ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.png'))
      : [];
    const cropFiles = fs.existsSync(cropsDir)
      ? fs.readdirSync(cropsDir).filter((f) => f.endsWith('.png'))
      : [];

    res.json({
      available: pdfExists,
      sourcePdfName: 'B.Indo 2.pdf',
      sourcePdfUrl: '/assets/aistudio/B.Indo_2_e376b629.pdf',
      renderedPagesCount: pageFiles.length,
      extractedVisualsCount: cropFiles.length,
    });
  });

  // 3. Admin-Authenticated PDF Upload & High-Resolution Extraction Engine
  app.post(
    '/api/pdf/upload',
    upload.single('pdfFile'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const admin = await verifyAdminRequest(req);
        if (!admin) {
          res.status(403).json({ error: 'Akses ditolak. Hanya administrator terverifikasi yang dapat mengunggah PDF.' });
          return;
        }

        if (!req.file || !req.file.buffer) {
          res.status(400).json({ error: 'Berkas PDF tidak ditemukan dalam permintaan.' });
          return;
        }

        const originalName = req.file.originalname || 'dokumen-soal.pdf';
        if (!originalName.toLowerCase().endsWith('.pdf')) {
          res.status(400).json({ error: 'Format berkas harus berupa PDF (.pdf).' });
          return;
        }

        const packSlug =
          'pack_' +
          Date.now().toString(36) +
          '_' +
          originalName
            .replace(/\.pdf$/i, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 32);

        const packDir = path.join(uploadsRoot, packSlug);
        const pagesDir = path.join(packDir, 'pages');
        fs.mkdirSync(pagesDir, { recursive: true });

        const savedPdfPath = path.join(packDir, 'source.pdf');
        fs.writeFileSync(savedPdfPath, req.file.buffer);
        const pdfPublicUrl = `/uploads/pdf-packs/${packSlug}/source.pdf`;

        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(req.file.buffer),
          // @ts-expect-error NodeCanvasFactory matches pdfjs runtime contract
          canvasFactory: new NodeCanvasFactory(),
          disableFontFace: false,
          useSystemFonts: true,
        });

        const pdf = await loadingTask.promise;
        const scale = 2.0;
        const extractedPages: Array<{
          pageNumber: number;
          previewUrl: string;
          width: number;
          height: number;
          lines: string[];
        }> = [];

        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale });
          const factory = new NodeCanvasFactory();
          const { canvas, context } = factory.create(viewport.width, viewport.height);

          await page.render({
            // @ts-expect-error napi-rs canvas 2D context is compatible with pdfjs
            canvasContext: context,
            viewport,
            canvasFactory: factory,
          }).promise;

          const pageFileName = `page-${String(p).padStart(2, '0')}.png`;
          fs.writeFileSync(path.join(pagesDir, pageFileName), canvas.toBuffer('image/png'));

          const textContent = await page.getTextContent();
          const rawItems = (textContent.items as Array<{ str?: string; transform?: number[] }>)
            .filter((it) => typeof it.str === 'string' && it.str.trim().length > 0)
            .map((it) => {
              const tx = pdfjsLib.Util.transform(viewport.transform, it.transform || [1, 0, 0, 1, 0, 0]);
              return { str: it.str!.trim(), x: Math.round(tx[4]), y: Math.round(tx[5]) };
            })
            .sort((a, b) => a.y - b.y || a.x - b.x);

          const groupedLines: Array<{ y: number; text: string }> = [];
          for (const item of rawItems) {
            const prev = groupedLines[groupedLines.length - 1];
            if (prev && Math.abs(prev.y - item.y) <= 12) {
              prev.text += ' ' + item.str;
            } else {
              groupedLines.push({ y: item.y, text: item.str });
            }
          }

          extractedPages.push({
            pageNumber: p,
            previewUrl: `/uploads/pdf-packs/${packSlug}/pages/${pageFileName}`,
            width: Math.round(viewport.width),
            height: Math.round(viewport.height),
            lines: groupedLines.map((l) => l.text),
          });
        }

        res.json({
          packId: packSlug,
          sourcePdfName: originalName,
          sourcePdfUrl: pdfPublicUrl,
          totalPages: pdf.numPages,
          pages: extractedPages,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4. Admin Interactive High-Res Crop Endpoint (from any rendered PDF page image)
  app.post('/api/pdf/crop', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = await verifyAdminRequest(req);
      if (!admin) {
        res.status(403).json({ error: 'Akses ditolak. Hanya administrator yang diizinkan memotong gambar.' });
        return;
      }

      const { pageImageUrl, xPercent, yPercent, wPercent, hPercent, targetName } = req.body as {
        pageImageUrl?: string;
        xPercent?: number;
        yPercent?: number;
        wPercent?: number;
        hPercent?: number;
        targetName?: string;
      };

      if (
        !pageImageUrl ||
        typeof xPercent !== 'number' ||
        typeof yPercent !== 'number' ||
        typeof wPercent !== 'number' ||
        typeof hPercent !== 'number'
      ) {
        res.status(400).json({ error: 'Parameter pemotongan gambar tidak lengkap.' });
        return;
      }

      // Prevent path traversal: allow only /assets/pdf-pages/ or /uploads/pdf-packs/
      const cleanRel = pageImageUrl.replace(/^\/+/, '');
      if (
        cleanRel.includes('..') ||
        (!cleanRel.startsWith('assets/pdf-pages/') && !cleanRel.startsWith('uploads/pdf-packs/'))
      ) {
        res.status(400).json({ error: 'Jalur halaman sumber tidak valid.' });
        return;
      }

      const absSource = path.join(__dirname, 'public', cleanRel);
      if (!fs.existsSync(absSource)) {
        res.status(404).json({ error: 'Gambar halaman PDF sumber tidak ditemukan di server.' });
        return;
      }

      const img = await loadImage(absSource);
      const sx = Math.max(0, Math.min(img.width - 10, Math.round((xPercent / 100) * img.width)));
      const sy = Math.max(0, Math.min(img.height - 10, Math.round((yPercent / 100) * img.height)));
      const sw = Math.max(10, Math.min(img.width - sx, Math.round((wPercent / 100) * img.width)));
      const sh = Math.max(10, Math.min(img.height - sy, Math.round((hPercent / 100) * img.height)));

      const outCanvas = createCanvas(sw, sh);
      const ctx = outCanvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const cropsOutDir = path.join(__dirname, 'public', 'uploads', 'custom-crops');
      fs.mkdirSync(cropsOutDir, { recursive: true });
      const safeLabel = (targetName || 'crop')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40);
      const fileName = `${safeLabel}_${Date.now().toString(36)}.png`;
      fs.writeFileSync(path.join(cropsOutDir, fileName), outCanvas.toBuffer('image/png'));

      res.json({
        cropUrl: `/uploads/custom-crops/${fileName}`,
        width: sw,
        height: sh,
      });
    } catch (err) {
      next(err);
    }
  });

  // 5. Admin Server-Side Gemini AI Multimodal Question Analyzer & Auto-Key Solver
  app.post('/api/ai/solve-question', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admin = await verifyAdminRequest(req);
      if (!admin) {
        res.status(403).json({
          error: 'Akses ditolak. Hanya administrator terverifikasi yang dapat menjalankan analisis AI.',
        });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          error: 'GEMINI_API_KEY belum tersedia pada server.',
        });
        return;
      }

      const { question } = req.body as {
        question?: {
          id?: string;
          originalNumber?: number;
          subject?: string;
          questionType?: string;
          stemText?: string;
          postImageText?: string;
          postSecondaryImageText?: string;
          imageUrls?: string[];
          secondaryImageUrls?: string[];
          sourcePagePreviewUrl?: string;
          options?: Array<{ id: string; label: string; text: string; imageUrl?: string }>;
          statements?: Array<{ id: string; label: string; text: string; imageUrl?: string }>;
        };
      };

      if (!question || !question.questionType || !question.stemText) {
        res.status(400).json({ error: 'Data soal tidak lengkap untuk dianalisis.' });
        return;
      }

      const loadSafePublicPngPart = (
        publicRelUrl?: string
      ): { inlineData: { mimeType: string; data: string } } | null => {
        if (!publicRelUrl || typeof publicRelUrl !== 'string') return null;
        const cleanRel = publicRelUrl.replace(/^\/+/, '');
        if (
          cleanRel.includes('..') ||
          (!cleanRel.startsWith('assets/') && !cleanRel.startsWith('uploads/'))
        ) {
          return null;
        }
        const absFile = path.join(__dirname, 'public', cleanRel);
        if (!fs.existsSync(absFile)) return null;
        const ext = path.extname(absFile).toLowerCase();
        const mimeType =
          ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
        return {
          inlineData: {
            mimeType,
            data: fs.readFileSync(absFile).toString('base64'),
          },
        };
      };

      const contentsParts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [];

      const resolvedSubject = question.subject || 'TKA Sekolah Dasar';
      contentsParts.push({
        text:
          `Anda adalah pakar ${resolvedSubject} Sekolah Dasar (TKA Kelas VI SD) yang teliti.\n` +
          `Analisis soal nomor ${question.originalNumber ?? '-'} (${resolvedSubject}) berikut beserta seluruh teks bacaan, bagan, infografis, atau gambar/diagram aslinya secara cermat.\n` +
          `Jenis soal: ${question.questionType}\n` +
          `Catatan notasi pecahan (jika ada): [[frac:a:b]] berarti pecahan a/b.\n\n` +
          `TEKS UTAMA SOAL:\n${question.stemText}`,
      });

      for (const imgUrl of question.imageUrls || []) {
        const part = loadSafePublicPngPart(imgUrl);
        if (part) {
          contentsParts.push({ text: 'Gambar utama soal:' });
          contentsParts.push(part);
        }
      }

      if (question.postImageText) {
        contentsParts.push({ text: `TEKS LANJUTAN:\n${question.postImageText}` });
      }

      for (const imgUrl of question.secondaryImageUrls || []) {
        const part = loadSafePublicPngPart(imgUrl);
        if (part) {
          contentsParts.push({ text: 'Gambar pendukung kedua:' });
          contentsParts.push(part);
        }
      }

      if (question.postSecondaryImageText) {
        contentsParts.push({ text: `INSTRUKSI AKHIR:\n${question.postSecondaryImageText}` });
      }

      if (question.questionType !== 'true_false' && Array.isArray(question.options)) {
        contentsParts.push({ text: 'DAFTAR PILIHAN JAWABAN:' });
        for (const opt of question.options) {
          contentsParts.push({
            text: `Pilihan ${opt.id} (${opt.label}): ${opt.text || '(lihat gambar pilihan)'}`,
          });
          if (opt.imageUrl) {
            const optImg = loadSafePublicPngPart(opt.imageUrl);
            if (optImg) contentsParts.push(optImg);
          }
        }
      }

      if (question.questionType === 'true_false' && Array.isArray(question.statements)) {
        contentsParts.push({ text: 'DAFTAR PERNYATAAN BENAR/SALAH:' });
        for (const st of question.statements) {
          contentsParts.push({
            text: `Pernyataan ${st.id} (${st.label}): ${st.text}`,
          });
          if (st.imageUrl) {
            const stImg = loadSafePublicPngPart(st.imageUrl);
            if (stImg) contentsParts.push(stImg);
          }
        }
      }

      // Attach full source PDF page preview if question has no cropped stem images yet (e.g. newly uploaded PDF)
      if (
        (!question.imageUrls || question.imageUrls.length === 0) &&
        question.sourcePagePreviewUrl
      ) {
        const pagePart = loadSafePublicPngPart(question.sourcePagePreviewUrl);
        if (pagePart) {
          contentsParts.push({ text: 'Halaman sumber PDF asli untuk referensi visual:' });
          contentsParts.push(pagePart);
        }
      }

      contentsParts.push({
        text:
          `Tentukan kunci jawaban yang 100% akurat sesuai aturan berikut:\n` +
          `1. Jika questionType = "single_choice", isi correctOptionId dengan tepat satu ID pilihan (mis. "A", "B", "C", atau "D"), kosongkan correctOptionIds dan statementKeysList.\n` +
          `2. Jika questionType = "multiple_choice_complex", isi correctOptionIds dengan seluruh ID pernyataan yang benar secara berurutan (mis. ["A", "C"]), kosongkan correctOptionId dan statementKeysList.\n` +
          `3. Jika questionType = "true_false", isi statementKeysList untuk setiap ID pernyataan (value = true untuk Benar / Sesuai / Setuju, dan value = false untuk Salah / Tidak Sesuai / Tidak Setuju), kosongkan correctOptionId dan correctOptionIds.\n` +
          `4. Tuliskan discussion dalam Bahasa Indonesia yang jelas, ringkas, dan menjelaskan dasar jawaban berdasarkan teks/gambar atau langkah perhitungannya.`,
      });

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: contentsParts }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              correctOptionId: {
                type: Type.STRING,
                description: 'ID pilihan benar tunggal untuk single_choice (A/B/C/D) atau string kosong.',
              },
              correctOptionIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Daftar ID pilihan benar untuk multiple_choice_complex.',
              },
              statementKeysList: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    value: { type: Type.BOOLEAN },
                  },
                  required: ['id', 'value'],
                },
                description: 'Kunci Benar/Salah tiap pernyataan untuk soal true_false.',
              },
              discussion: {
                type: Type.STRING,
                description: 'Langkah-langkah analisis dan pembahasan resmi dalam Bahasa Indonesia.',
              },
            },
            required: ['correctOptionId', 'correctOptionIds', 'statementKeysList', 'discussion'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as {
        correctOptionId?: string;
        correctOptionIds?: string[];
        statementKeysList?: Array<{ id: string; value: boolean }>;
        discussion?: string;
      };

      const statementKeys: Record<string, boolean> = {};
      for (const item of parsed.statementKeysList || []) {
        if (item && typeof item.id === 'string' && typeof item.value === 'boolean') {
          statementKeys[item.id] = item.value;
        }
      }

      res.json({
        correctOptionId: parsed.correctOptionId || '',
        correctOptionIds: Array.isArray(parsed.correctOptionIds)
          ? [...parsed.correctOptionIds].sort()
          : [],
        statementKeys,
        discussion: parsed.discussion || '',
      });
    } catch (err) {
      next(err);
    }
  });

  // Global API error handler
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Terjadi kesalahan pada server.',
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use('/assets/aistudio', express.static(path.join(__dirname, 'public', 'assets', 'aistudio')));
    app.use('/assets/pdf-pages', express.static(path.join(__dirname, 'public', 'assets', 'pdf-pages')));
    app.use('/assets/pdf-crops', express.static(path.join(__dirname, 'public', 'assets', 'pdf-crops')));
    app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
    app.use(express.static(distPath));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SIMULASI TKA SD CBT Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
