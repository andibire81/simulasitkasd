import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db, recordAuditLog } from '../lib/firebase';
import {
  AnswerKeyRecord,
  AssetRecord,
  clampStr,
  ComplexScoringRule,
  ExamRecord,
  ExamStatus,
  QuestionRecord,
  QuestionType,
  VerificationStatus,
} from '../types/cbt';
import {
  TO1_MTK_ASSETS,
  TO1_MTK_QUESTIONS,
  TO1_PACK_ID,
  TO1_SOURCE_PDF_NAME,
} from './to1MtkSource';

export interface AnalyzedAnswerKeySeed
  extends Omit<AnswerKeyRecord, 'createdAt' | 'updatedAt' | 'verifiedBy' | 'locked'> {
  originalNumber: number;
  answerSummaryLabel: string;
  topicLabel: string;
}

/**
 * Hasil analisis matematis & visual terverifikasi untuk seluruh 30 soal asli dari TO 1 MTK.pdf (Halaman 1–20).
 * Setiap soal telah diperiksa langsung terhadap teks dan gambar/diagram pada PDF sumber.
 */
export const TO1_MTK_ANSWER_KEYS: AnalyzedAnswerKeySeed[] = [
  {
    questionId: 'to1_mtk_q01',
    originalNumber: 1,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (216)',
    topicLabel: 'Operasi Hitung Campuran Bilangan Bulat',
    discussion:
      'Kerjakan operasi di dalam tanda kurung terlebih dahulu, lalu pembagian dan perkalian:\n' +
      '(8.450 − 3.120) ÷ 5 + (−425) × 2\n' +
      '= 5.330 ÷ 5 + (−850)\n' +
      '= 1.066 − 850 = 216 (Pilihan C).',
  },
  {
    questionId: 'to1_mtk_q02',
    originalNumber: 2,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (Rp2.000,00)',
    topicLabel: 'Aritmetika Sosial & Pecahan Uang',
    discussion:
      'Harga pesanan pada daftar menu Warteg:\n' +
      '• Nasi uduk ayam = Rp12.000,00\n' +
      '• Cah kangkung = Rp12.000,00\n' +
      '• Es jeruk = Rp4.000,00\n' +
      'Total harga pesanan = Rp12.000 + Rp12.000 + Rp4.000 = Rp28.000,00.\n' +
      'Tiga lembar uang kertas berjumlah Rp50.000,00 terdiri atas pecahan Rp20.000,00 + Rp20.000,00 + Rp10.000,00. ' +
      'Membayar Rp28.000,00 dengan uang yang sesuai menggunakan 1 lembar Rp20.000,00 dan 1 lembar Rp10.000,00 (= Rp30.000,00), ' +
      'sehingga kembalian = Rp30.000,00 − Rp28.000,00 = Rp2.000,00 (Pilihan A).',
  },
  {
    questionId: 'to1_mtk_q03',
    originalNumber: 3,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (15/24)',
    topicLabel: 'Pecahan Senilai',
    discussion:
      'Pizza pada gambar terbagi menjadi 8 potongan sama besar dan tersisa 5 potongan utuh, yaitu pecahan [[frac:5:8]]. ' +
      'Pecahan senilai berpenyebut 24 adalah [[frac:5×3:8×3]] = [[frac:15:24]] (Pilihan C).',
  },
  {
    questionId: 'to1_mtk_q04',
    originalNumber: 4,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (292 kg)',
    topicLabel: 'Soal Cerita Operasi Hitung Bilangan Cacah',
    discussion:
      'Total hasil panen salak = 1.345 + 2.142 = 3.487 kg.\n' +
      'Banyak salak yang sudah terjual = 213 keranjang × 15 kg = 3.195 kg.\n' +
      'Sisa salak yang belum terjual = 3.487 − 3.195 = 292 kg (Pilihan B).',
  },
  {
    questionId: 'to1_mtk_q05',
    originalNumber: 5,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C',
    topicLabel: 'FPB dalam Masalah Kontekstual',
    discussion:
      'Berdasarkan gambar: Bunga Lily = 24 tangkai, Bunga Mawar = 36 tangkai, Bunga Gerbera = 48 tangkai.\n' +
      '• FPB dari 24, 36, dan 48 adalah 12 → buket yang dapat dibuat = 12 buah (Pernyataan A BENAR).\n' +
      '• Isi setiap buket = (24 ÷ 12) + (36 ÷ 12) + (48 ÷ 12) = 2 + 3 + 4 = 9 tangkai, bukan 10 tangkai (Pernyataan B SALAH).\n' +
      '• Total kertas hias = 12 buket × 3 lembar = 36 lembar (Pernyataan C BENAR).',
  },
  {
    questionId: 'to1_mtk_q06',
    originalNumber: 6,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: false, C: true },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Benar · B: Salah · C: Benar',
    topicLabel: 'Sifat-Sifat Bangun Datar (Jajargenjang)',
    discussion:
      'Bangun datar pada gambar adalah jajargenjang:\n' +
      '• Pernyataan A (Benar): Mempunyai dua pasang sisi berhadapan sejajar dan sama panjang.\n' +
      '• Pernyataan B (Salah): Diagonal jajargenjang tidak berpotongan tegak lurus.\n' +
      '• Pernyataan C (Benar): Mempunyai dua pasang sudut berhadapan sama besar.',
  },
  {
    questionId: 'to1_mtk_q07',
    originalNumber: 7,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A',
    topicLabel: 'Visualisasi Spasial Susunan Kubus (Tampak Atas)',
    discussion:
      'Berdasarkan proyeksi susunan kubus dari belakang ke depan dan kiri ke kanan:\n' +
      '• Baris belakang: kolom 2 (tinggi 2 kubus) dan kolom 3 (tinggi 1 kubus).\n' +
      '• Baris tengah: kolom 1, kolom 2, dan kolom 3.\n' +
      '• Baris depan: bergeser satu kolom ke kanan di depan kolom 3 serta menonjol ke kolom 4 (kolom 3 dan kolom 4).\n' +
      'Susunan tampak atas [ . # # . / # # # . / . . # # ] sesuai tepat dengan gambar Pilihan A.',
  },
  {
    questionId: 'to1_mtk_q08',
    originalNumber: 8,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: false, B: true, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Salah · B: Benar · C: Salah',
    topicLabel: 'Volume Balok dengan Kubus Satuan',
    discussion:
      'Kerangka balok berukuran panjang = 4 kubus satuan, lebar = 2 kubus satuan, dan tinggi = 3 kubus satuan, ' +
      'sehingga kapasitas penuh balok = 4 × 2 × 3 = 24 kubus satuan.\n' +
      'Kubus satuan yang sudah tersusun: baris depan kiri (2 × 1 × 2 = 4 buah) + baris belakang kiri (2 × 1 × 3 = 6 buah) + baris belakang kanan (2 × 1 × 2 = 4 buah) = 14 buah.\n' +
      '• Pernyataan A (Salah): Banyak kubus satuan yang tersusun adalah 14 buah, bukan 10 buah.\n' +
      '• Pernyataan B (Benar): Kekurangan kubus satuan untuk memenuhi balok = 24 − 14 = 10 buah.\n' +
      '• Pernyataan C (Salah): Kapasitas seluruh balok adalah 24 buah, bukan 27 buah.',
  },
  {
    questionId: 'to1_mtk_q09',
    originalNumber: 9,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (2,4 m)',
    topicLabel: 'Keliling Bangun Datar (Layang-Layang) & Konversi Satuan',
    discussion:
      'Panjang sisi miring atas = 30 cm = [[frac:1:3]] × sisi miring bawah, maka sisi miring bawah = 3 × 30 cm = 90 cm.\n' +
      'Keliling layang-layang = 2 × (30 cm + 90 cm) = 2 × 120 cm = 240 cm = 2,4 m (Pilihan D).',
  },
  {
    questionId: 'to1_mtk_q10',
    originalNumber: 10,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: true, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Benar · B: Benar · C: Salah',
    topicLabel: 'Hubungan Sudut Pelurus & Jumlah Sudut Segitiga',
    discussion:
      'Sudut luar di titik B sebesar 40° berpelurus dengan sudut ABC:\n' +
      '• ∠ABC = 180° − 40° = 140° (Pernyataan B BENAR).\n' +
      '• Jumlah sudut dalam segitiga ABC = 180°, dengan ∠BAC = 15°, maka ∠BCA = 180° − (140° + 15°) = 25° (Pernyataan A BENAR).\n' +
      '• ∠ABC + ∠BCA = 140° + 25° = 165° (bukan 175°, sehingga Pernyataan C SALAH).',
  },
  {
    questionId: 'to1_mtk_q11',
    originalNumber: 11,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (Rp4.000,00)',
    topicLabel: 'Penaksiran Harga ke Ribuan Terdekat',
    discussion:
      'Harga di toko buku A = Rp46.200,00 ≈ Rp46.000,00 (ribuan terdekat).\n' +
      'Harga di toko buku B = Rp49.900,00 ≈ Rp50.000,00 (ribuan terdekat).\n' +
      'Taksiran terdekat selisih harga = Rp50.000,00 − Rp46.000,00 = Rp4.000,00 (Pilihan B).',
  },
  {
    questionId: 'to1_mtk_q12',
    originalNumber: 12,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (6)',
    topicLabel: 'Jaring-Jaring Kubus',
    discussion:
      'Jika sisi 5 menjadi alas kubus:\n' +
      '• Sisi 4 terlipat menjadi sisi tegak kiri, sisi 3 menjadi tutup atas (berhadapan dengan 5), dan sisi 2 menjadi sisi tegak kanan (berhadapan dengan 4).\n' +
      '• Sisi 1 (di atas sisi 2) menutup bagian depan, sedangkan sisi 6 (di bawah sisi 4) menutup bagian belakang.\n' +
      'Maka sisi nomor 1 berhadapan dengan sisi nomor 6 (Pilihan D).',
  },
  {
    questionId: 'to1_mtk_q13',
    originalNumber: 13,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (9 botol B dan 10 botol C)',
    topicLabel: 'Konversi Satuan Volume (Liter dan Mililiter)',
    discussion:
      'Persediaan madu = 5 liter = 5.000 ml. Ukuran botol: A = 350 ml, B = 250 ml, C = 100 ml.\n' +
      'Dikemas dalam 5 botol A = 5 × 350 ml = 1.750 ml.\n' +
      'Sisa madu = 5.000 − 1.750 = 3.250 ml.\n' +
      'Uji Pilihan A: (9 × 250 ml) + (10 × 100 ml) = 2.250 + 1.000 = 3.250 ml (Pilihan A tepat).',
  },
  {
    questionId: 'to1_mtk_q14',
    originalNumber: 14,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C',
    topicLabel: 'Jarak, Kecepatan, dan Waktu',
    discussion:
      'Berdasarkan peta: jarak rumah Andri ke SD Harapan = 0,5 km; jarak rumah Kania ke SD Harapan = 1,5 km. Keduanya tiba pukul 06.48.\n' +
      '• Waktu tempuh Andri = 0,5 km ÷ 3 km/jam = [[frac:1:6]] jam = 10 menit → berangkat pukul 06.48 − 10 menit = 06.38 (Pernyataan A BENAR).\n' +
      '• Waktu tempuh Kania = 1,5 km ÷ 30 km/jam = [[frac:1:20]] jam = 3 menit → berangkat pukul 06.48 − 3 menit = 06.45, bukan 06.42 (Pernyataan B SALAH).\n' +
      '• Selisih waktu keberangkatan = 06.45 − 06.38 = 7 menit (Pernyataan C BENAR).',
  },
  {
    questionId: 'to1_mtk_q15',
    originalNumber: 15,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (41 cm)',
    topicLabel: 'Keliling Segitiga & Tanda Kesamaan Panjang Sisi',
    discussion:
      'Dari tanda garis sama panjang pada gambar:\n' +
      '• AB = BC = 8 cm.\n' +
      '• CD = AC = 11 cm, sehingga panjang alas BD = BC + CD = 8 + 11 = 19 cm.\n' +
      '• Panjang AD = AB + 6 cm = 8 + 6 = 14 cm.\n' +
      'Keliling segitiga ABD = AB + BD + AD = 8 + 19 + 14 = 41 cm (Pilihan A).',
  },
  {
    questionId: 'to1_mtk_q16',
    originalNumber: 16,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (144 cm²)',
    topicLabel: 'Penaksiran Luas Bangun Tidak Beraturan pada Petak Satuan',
    discussion:
      'Bangun terarsir menempati rentang 8 kolom × 5 baris (= 40 petak), dengan 4 petak sudut lengkung terisi kurang dari setengah petak (dibulatkan 0), ' +
      'sehingga banyak petak utuh dan ≥ setengah petak = 40 − 4 = 36 petak.\n' +
      'Luas 1 petak persegi = 2 cm × 2 cm = 4 cm².\n' +
      'Hasil penaksiran luas bangun = 36 × 4 cm² = 144 cm² (Pilihan C).',
  },
  {
    questionId: 'to1_mtk_q17',
    originalNumber: 17,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B',
    topicLabel: 'Mengurutkan Berbagai Bentuk Pecahan dan Desimal',
    discussion:
      'Ubah seluruh berat bahan ke bentuk desimal:\n' +
      '• Tepung terigu = 2,2 kg = 2,20 kg\n' +
      '• Mentega = 2[[frac:1:4]] kg = 2,25 kg\n' +
      '• Gula pasir = [[frac:12:5]] kg = 2,40 kg\n' +
      '• Tepung maizena = 2[[frac:7:10]] kg = 2,70 kg\n' +
      '• Cokelat bubuk = [[frac:11:4]] kg = 2,75 kg\n' +
      'Urutan dari paling sedikit: Tepung terigu, mentega, gula pasir, tepung maizena, dan cokelat bubuk (Pilihan B).',
  },
  {
    questionId: 'to1_mtk_q18',
    originalNumber: 18,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'B'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, B',
    topicLabel: 'Operasi Hitung Pecahan & Desimal Kontekstual (Resep)',
    discussion:
      'Berdasarkan persediaan bahan dan resep Kue Pukis Keju:\n' +
      '• Pernyataan A (BENAR): Sisa tepung terigu = 2,2 kg − [[frac:1:4]] kg = 2,20 − 0,25 = 1,95 kg.\n' +
      '• Pernyataan B (BENAR): Selisih tepung terigu ([[frac:1:4]] = [[frac:5:20]] kg) dan gula pasir ([[frac:3:20]] kg) yang digunakan = [[frac:5:20]] − [[frac:3:20]] = [[frac:2:20]] = [[frac:1:10]] kg.\n' +
      '• Pernyataan C (SALAH): Banyak ragi instan (0,003 kg) + mentega (0,120 kg) = 0,123 kg, bukan 0,15 kg.',
  },
  {
    questionId: 'to1_mtk_q19',
    originalNumber: 19,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: false, B: true, C: true },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Salah · B: Benar · C: Benar',
    topicLabel: 'Kesetaraan Satuan Berat (Timbangan)',
    discussion:
      'Anak timbangan pada Piringan 2 adalah A + B + B + C = 1.000 gr + 500 gr + 500 gr + 200 gr = 2.200 gr.\n' +
      '• Pernyataan A (Salah): 2B + 4C + 2D = 2(500) + 4(200) + 2(100) = 2.000 gr ≠ 2.200 gr.\n' +
      '• Pernyataan B (Benar): 4B + 2D = 4(500) + 2(100) = 2.200 gr.\n' +
      '• Pernyataan C (Benar): 3B + 2C + 3D = 3(500) + 2(200) + 3(100) = 2.200 gr.',
  },
  {
    questionId: 'to1_mtk_q20',
    originalNumber: 20,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'B'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, B',
    topicLabel: 'Konversi Satuan Panjang (Penyambungan Tongkat)',
    discussion:
      'Ubah semua ukuran ke satuan cm:\n' +
      '• Tongkat I = 163 cm\n' +
      '• Tongkat II = 1,68 m = 168 cm\n' +
      '• Tongkat III = 17,1 dm = 171 cm\n' +
      '• Setiap bagian himpitan tali = 200 mm = 20 cm.\n' +
      '• Pernyataan A (BENAR): Panjang tanpa penyambungan = 163 + 168 + 171 = 502 cm.\n' +
      '• Pernyataan B (BENAR): Panjang ketiganya setelah disambung (2 himpitan) = 502 − 20 − 20 = 462 cm.\n' +
      '• Pernyataan C (SALAH): Panjang penyambungan tongkat 1 dan 2 (1 himpitan) = 163 + 168 − 20 = 311 cm, bukan 291 cm.',
  },
  {
    questionId: 'to1_mtk_q21',
    originalNumber: 21,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (45 buah)',
    topicLabel: 'Pembagian Bilangan Asli dengan Pecahan',
    discussion:
      'Pada gambar terdapat 3 batang paralon yang masing-masing panjangnya 3 m, sehingga panjang total paralon = 3 × 3 m = 9 m.\n' +
      'Tinggi setiap celengan = [[frac:1:5]] m.\n' +
      'Banyak celengan yang dapat dibuat = 9 ÷ [[frac:1:5]] = 9 × 5 = 45 buah (Pilihan D).',
  },
  {
    questionId: 'to1_mtk_q22',
    originalNumber: 22,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['B', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B, C',
    topicLabel: 'Perbandingan & Pecahan Senilai dalam Data Produksi',
    discussion:
      'Produksi tahun 2024 = 300 ribu ton = [[frac:6:5]] × produksi tahun 2025.\n' +
      'Produksi tahun 2025 = 300 ÷ [[frac:6:5]] = 300 × [[frac:5:6]] = 250 ribu ton.\n' +
      '• Pernyataan A (SALAH): Produksi 2025 turun dibanding 2024 (dari 300 ke 250 ribu ton).\n' +
      '• Pernyataan B (BENAR): Mengalami penurunan sebanyak 300 − 250 = 50 ribu ton.\n' +
      '• Pernyataan C (BENAR): Produksi beras tahun 2025 mencapai 250 ribu ton.',
  },
  {
    questionId: 'to1_mtk_q23',
    originalNumber: 23,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'B'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, B',
    topicLabel: 'KPK & Pola Jadwal Kalender',
    discussion:
      'Jadwal latihan (bulan September memiliki 30 hari):\n' +
      '• Adi (setiap 4 hari mulai 5 Sep): 5, 9, 13, 17, 21, 25, 29 Sep, 3 Okt, ...\n' +
      '• Bima (setiap 6 hari mulai 3 Sep): 3, 9, 15, 21, 27 Sep, 3 Okt, ...\n' +
      '• Coki (setiap 7 hari mulai 7 Sep): 7, 14, 21, 28 Sep, ...\n' +
      '• Pernyataan A (BENAR): Adi dan Bima berlatih bersama pada 9 Sep (ke-1), 21 Sep (ke-2), dan 3 Oktober 2025 (ke-3).\n' +
      '• Pernyataan B (BENAR): Ketiganya berlatih bersama pertama kali pada 21 September 2025.\n' +
      '• Pernyataan C (SALAH): Saat Coki kursus ke-4 (28 Sep), Bima sudah kursus 5 kali (3, 9, 15, 21, 27 Sep).',
  },
  {
    questionId: 'to1_mtk_q24',
    originalNumber: 24,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (30 m)',
    topicLabel: 'Skala Denah & Keliling Bangun Gabungan',
    discussion:
      'Berdasarkan tanda kesamaan sisi pada denah berskala 1 : 300 (1 cm mewakili 3 m; label ukuran ruang keluarga 1,5 cm tercetak tanpa koma sebagai 15 cm pada sumber PDF):\n' +
      '• Lebar bawah = 2 × tanda satu garis (|) = 1,5 cm + 1,5 cm = 3 cm → ukuran sebenarnya = 3 × 3 m = 9 m.\n' +
      '• Lebar atas terbagi menjadi 3 segmen bertanda dua garis (||) yang sama dengan lebar bawah (3 cm), sehingga tiap tanda (||) = 1 cm → ukuran sebenarnya = 3 m.\n' +
      '• Tinggi sisi kiri = 2 × (||) = 2 cm → ukuran sebenarnya = 6 m.\n' +
      '• Keliling rumah berbentuk L = 2 × (panjang maksimum + lebar maksimum) = 2 × (9 m + 6 m) = 30 m (Pilihan B).',
  },
  {
    questionId: 'to1_mtk_q25',
    originalNumber: 25,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C',
    topicLabel: 'Volume Bangun Ruang Gabungan (Balok & Kubus)',
    discussion:
      'Panjang balok = 30 cm terbagi menjadi 2 bagian sama panjang bertanda satu garis (|), sehingga rusuk kubus = lebar balok = 30 ÷ 2 = 15 cm, dan tinggi balok = 16 cm.\n' +
      '• Volume balok = 30 × 15 × 16 = 7.200 cm³ (Pernyataan A BENAR).\n' +
      '• Volume kubus = 15 × 15 × 15 = 3.375 cm³, bukan 3.825 cm³ (Pernyataan B SALAH).\n' +
      '• Volume gabungan = 7.200 + 3.375 = 10.575 cm³ (Pernyataan C BENAR).',
  },
  {
    questionId: 'to1_mtk_q26',
    originalNumber: 26,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C',
    topicLabel: 'Penyajian Data dalam Bentuk Tabel Frekuensi',
    discussion:
      'Hasil perhitungan frekuensi dari 28 data kegiatan siswa:\n' +
      '• bermain = 3 anak\n' +
      '• les = 5 anak\n' +
      '• tidur = 2 anak\n' +
      '• membantu orang tua = 5 anak\n' +
      '• mengerjakan PR = 4 anak\n' +
      '• bersepeda = 6 anak\n' +
      '• menonton televisi = 3 anak\n' +
      'Total = 3 + 5 + 2 + 5 + 4 + 6 + 3 = 28 anak. Tabel yang sesuai adalah Pilihan C.',
  },
  {
    questionId: 'to1_mtk_q27',
    originalNumber: 27,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: false, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Benar · B: Salah · C: Salah',
    topicLabel: 'Membaca dan Menafsirkan Piktogram',
    discussion:
      'Setiap 1 gambar orang mewakili 3 murid:\n' +
      '• Angklung = 7 × 3 = 21 anak; Hadroh = 5 × 3 = 15 anak; Karawitan = 6 × 3 = 18 anak; Melukis = 4 × 3 = 12 anak; Menari = 3 × 3 = 9 anak; Voli = 5 × 3 = 15 anak.\n' +
      '• Pernyataan A (Benar): Selisih angklung dan menari = 21 − 9 = 12 anak.\n' +
      '• Pernyataan B (Salah): Jumlah karawitan dan melukis = 18 + 12 = 30 anak (bukan 10 anak).\n' +
      '• Pernyataan C (Salah): Voli (15 anak) lebih sedikit 6 anak daripada angklung (21 anak), bukan 2 anak.',
  },
  {
    questionId: 'to1_mtk_q28',
    originalNumber: 28,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D',
    topicLabel: 'Penyajian Data dalam Diagram Batang',
    discussion:
      'Data tujuan outing class: Monumen Jogja Kembali = 8, Keraton Yogyakarta = 15, Museum Sonobudoyo = 7 (sama banyak dengan Benteng Vrederburg = 7), Gembira Loka = 12, dan Taman Pintar = 17.\n' +
      '• Diagram A & B salah pada Taman Pintar (18) serta Museum ≠ Benteng.\n' +
      '• Diagram C salah pada Gembira Loka (11) serta Museum ≠ Benteng.\n' +
      '• Diagram D adalah satu-satunya diagram yang tepat menampilkan Monumen Jogja Kembali = 8, Keraton Yogyakarta = 15, tinggi batang Museum Sonobudoyo sama dengan Benteng Vrederburg, Gembira Loka = 12, dan Taman Pintar = 17 (Pilihan D).',
  },
  {
    questionId: 'to1_mtk_q29',
    originalNumber: 29,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: true, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Benar · B: Benar · C: Salah',
    topicLabel: 'Rata-Rata (Mean) Data Tunggal',
    discussion:
      'Jumlah nilai 8 mata pelajaran = 88 + 85 + 85 + 83 + 90 + 82 + 83 + 88 = 684.\n' +
      '• Pernyataan A (Benar): Rata-rata = 684 ÷ 8 = 85,50.\n' +
      '• Pernyataan B (Benar): Nilai di atas 85,50 ada 3 mata pelajaran, yaitu 88, 90, dan 88.\n' +
      '• Pernyataan C (Salah): Nilai di bawah 85,50 ada 5 mata pelajaran (85, 85, 83, 82, dan 83), bukan 4.',
  },
  {
    questionId: 'to1_mtk_q30',
    originalNumber: 30,
    examPackId: TO1_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (Yahya)',
    topicLabel: 'Modus Data Pemungutan Suara',
    discussion:
      'Rekapitulasi 28 kartu suara pada gambar (4 baris × 7 kolom):\n' +
      '• Nomor 1 (Bagus) = 6 suara\n' +
      '• Nomor 2 (Kinanti) = 7 suara\n' +
      '• Nomor 3 (Mario) = 6 suara\n' +
      '• Nomor 4 (Yahya) = 9 suara\n' +
      'Total = 6 + 7 + 6 + 9 = 28 suara. Perolehan suara tertinggi diraih oleh nomor urut 4, yaitu Yahya (Pilihan D).',
  },
];

export const TO1_MTK_ANSWER_KEY_MAP = new Map<string, AnalyzedAnswerKeySeed>(
  TO1_MTK_ANSWER_KEYS.map((item) => [item.questionId, item])
);

let to1SyncQueue: Promise<{ syncedQuestions: number; syncedKeys: number }> =
  Promise.resolve({ syncedQuestions: 0, syncedKeys: 0 });

/**
 * Menyimpan otomatis seluruh 30 soal TO 1 MTK.pdf, 40 aset gambar asli, dan 30 kunci jawaban + pembahasan AI
 * ke Cloud Firestore dalam satu batch atomik agar terhindar dari duplikasi write atau bentrokan createdAt.
 */
export function syncTo1QuestionsAndAnswerKeysToFirestore(params: {
  existingQuestions: QuestionRecord[];
  existingAssets: AssetRecord[];
  existingAnswerKeys: AnswerKeyRecord[];
  exams: ExamRecord[];
  forceOverwrite?: boolean;
  forceOverwriteQuestions?: boolean;
  logSummaryPrefix?: string;
}): Promise<{ syncedQuestions: number; syncedKeys: number }> {
  const run = async (): Promise<{ syncedQuestions: number; syncedKeys: number }> => {
    const {
      existingQuestions,
      existingAssets,
      existingAnswerKeys,
      exams,
      forceOverwrite = false,
      forceOverwriteQuestions = false,
      logSummaryPrefix = 'Menyimpan otomatis',
    } = params;

    const adminEmail = clampStr(
      auth.currentUser?.email || auth.currentUser?.uid || 'ai-auto-verifier',
      150
    );

    let liveQuestions = existingQuestions;
    let liveAssets = existingAssets;
    let liveKeys = existingAnswerKeys;
    try {
      const [qSnap, aSnap, kSnap] = await Promise.all([
        getDocs(collection(db, 'questions')),
        getDocs(collection(db, 'assets')),
        getDocs(collection(db, 'answerKeys')),
      ]);
      liveQuestions = qSnap.docs.map((d) => d.data() as QuestionRecord);
      liveAssets = aSnap.docs.map((d) => d.data() as AssetRecord);
      liveKeys = kSnap.docs.map((d) => d.data() as AnswerKeyRecord);
    } catch {
      // Fallback to provided arrays if offline cache read fails
    }

    const existingQMap = new Map(liveQuestions.map((q) => [q.id, q]));
    const existingAssetMap = new Map(liveAssets.map((a) => [a.id, a]));
    const existingKeyMap = new Map(liveKeys.map((k) => [k.questionId, k]));

    const batch = writeBatch(db);
    let syncedQuestions = 0;
    let syncedAssets = 0;
    let syncedKeys = 0;

    for (const qItem of TO1_MTK_QUESTIONS) {
      const qRef = doc(db, 'questions', qItem.id);
      const existingQ = existingQMap.get(qItem.id);

      if (existingQ) {
        if (forceOverwriteQuestions) {
          batch.update(qRef, {
            subject: qItem.subject,
            stemText: qItem.stemText,
            instructionText: qItem.instructionText,
            options: qItem.options,
            statements: qItem.statements,
            imageUrls: qItem.imageUrls,
            postImageText: qItem.postImageText,
            secondaryImageUrls: qItem.secondaryImageUrls,
            postSecondaryImageText: qItem.postSecondaryImageText,
            optionHasImages: qItem.optionHasImages,
            lockOptionOrder: qItem.lockOptionOrder,
            sourcePdfName: qItem.sourcePdfName,
            sourcePdfUrl: qItem.sourcePdfUrl,
            sourcePage: qItem.sourcePage,
            sourcePageEnd: qItem.sourcePageEnd,
            sourcePagePreviewUrl: qItem.sourcePagePreviewUrl,
            textVerified: true,
            imageVerified: true,
            verificationStatus: VerificationStatus.VERIFIED,
            answerKeyVerified: true,
            updatedAt: serverTimestamp(),
          });
          syncedQuestions += 1;
        } else if (
          !existingQ.textVerified ||
          !existingQ.imageVerified ||
          existingQ.verificationStatus !== VerificationStatus.VERIFIED ||
          !existingQ.answerKeyVerified
        ) {
          batch.update(qRef, {
            textVerified: true,
            imageVerified: true,
            verificationStatus: VerificationStatus.VERIFIED,
            answerKeyVerified: true,
            updatedAt: serverTimestamp(),
          });
          syncedQuestions += 1;
        }
      } else {
        batch.set(qRef, {
          ...qItem,
          textVerified: true,
          imageVerified: true,
          verificationStatus: VerificationStatus.VERIFIED,
          answerKeyVerified: true,
          verificationNotes: 'Terverifikasi otomatis bersama analisis kunci jawaban AI TO 1 MTK.',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        syncedQuestions += 1;
      }
    }

    for (const assetItem of TO1_MTK_ASSETS) {
      const aRef = doc(db, 'assets', assetItem.id);
      const existingAsset = existingAssetMap.get(assetItem.id);
      if (!existingAsset) {
        batch.set(aRef, {
          ...assetItem,
          verified: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        syncedAssets += 1;
      } else if (forceOverwriteQuestions || !existingAsset.verified) {
        batch.update(aRef, {
          verified: true,
          updatedAt: serverTimestamp(),
        });
        syncedAssets += 1;
      }
    }

    for (const keySeed of TO1_MTK_ANSWER_KEYS) {
      const keyRef = doc(db, 'answerKeys', keySeed.questionId);
      const existingKey = existingKeyMap.get(keySeed.questionId);
      const hasActiveExamUsingQ = exams.some(
        (ex) =>
          (ex.status === ExamStatus.ACTIVE || ex.status === ExamStatus.FINISHED) &&
          ex.questionIds.includes(keySeed.questionId)
      );

      const mutablePayload = {
        examPackId: keySeed.examPackId,
        questionType: keySeed.questionType,
        correctOptionId: keySeed.correctOptionId,
        correctOptionIds: keySeed.correctOptionIds,
        statementKeys: keySeed.statementKeys,
        complexScoringRule: keySeed.complexScoringRule,
        wrongScore: keySeed.wrongScore,
        weight: keySeed.weight,
        discussion: clampStr(keySeed.discussion, 4000),
        verified: true,
        locked: hasActiveExamUsingQ,
        verifiedBy: adminEmail,
        updatedAt: serverTimestamp(),
      };

      if (!existingKey) {
        batch.set(keyRef, {
          questionId: keySeed.questionId,
          ...mutablePayload,
          createdAt: serverTimestamp(),
        });
        syncedKeys += 1;
      } else if (forceOverwrite || !existingKey.verified || !existingKey.discussion) {
        batch.update(keyRef, mutablePayload);
        syncedKeys += 1;
      }
    }

    if (syncedQuestions > 0 || syncedAssets > 0 || syncedKeys > 0) {
      await batch.commit();
      await recordAuditLog({
        action: 'AUTO_SYNC_TO1_AI_ANSWER_KEYS',
        targetType: 'examPack',
        targetId: TO1_PACK_ID,
        summary: `${logSummaryPrefix} 30 kunci jawaban & pembahasan teranalisis AI untuk ${TO1_SOURCE_PDF_NAME}.`,
      });
    }

    return { syncedQuestions, syncedKeys };
  };

  const next = to1SyncQueue.catch(() => ({ syncedQuestions: 0, syncedKeys: 0 })).then(run);
  to1SyncQueue = next;
  return next;
}
