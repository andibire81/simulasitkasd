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
import { AnalyzedAnswerKeySeed } from './to1MtkAnswerKeys';
import {
  BINDO2_ASSETS,
  BINDO2_PACK_ID,
  BINDO2_QUESTIONS,
  BINDO2_SOURCE_PDF_NAME,
} from './bindo2Source';

/**
 * Hasil analisis literasi, kebahasaan, & visual terverifikasi untuk seluruh 30 soal asli dari B.Indo 2.pdf (Halaman 1–18).
 * Setiap soal telah diperiksa langsung terhadap teks bacaan, bagan alir, infografis, dan ilustrasi pada PDF sumber.
 */
export const BINDO2_ANSWER_KEYS: AnalyzedAnswerKeySeed[] = [
  {
    questionId: 'bindo_2_q01',
    originalNumber: 1,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (irigasi dan panen)',
    topicLabel: 'Kosakata Khusus Bidang Pertanian',
    discussion:
      'Dalam paragraf tentang pengelolaan sawah, kosakata khusus bidang pertanian yang muncul adalah "irigasi" (sistem pengairan lahan pertanian) dan "panen" (pemungutan hasil tanaman di sawah). Kata seperti warga, hasil, air, dan cukup merupakan kosakata umum (Pilihan D).',
  },
  {
    questionId: 'bindo_2_q02',
    originalNumber: 2,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (televisi)',
    topicLabel: 'Mengidentifikasi Objek Berdasarkan Ciri Teks Deskripsi',
    discussion:
      'Pada paragraf kedua disebutkan ciri-ciri benda: "berbentuk persegi panjang, tipis, dan permukaannya mengilap dilapisi kaca. Sebuah benda yang mampu menampilkan gambar bergerak dan suara." Ciri tersebut merujuk pada televisi (Pilihan C).',
  },
  {
    questionId: 'bindo_2_q03',
    originalNumber: 3,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (kamar Rio)',
    topicLabel: 'Latar Tempat dalam Teks Cerita',
    discussion:
      'Pada paragraf pertama tertulis jelas: "Di kamarnya, Rio sudah memakai seragam sekolah. Meja belajar yang kemarin sempat berantakan, kini tertata rapi... Bolpoin dan pensil warna berdiri tegak di dalam sebuah wadah kayu." Jadi wadah kayu tersebut berada di kamar Rio (Pilihan A).',
  },
  {
    questionId: 'bindo_2_q04',
    originalNumber: 4,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (Bagan C)',
    topicLabel: 'Menyajikan Informasi Teks ke dalam Bagan Alir',
    discussion:
      'Urutan gagasan pokok setiap paragraf pada teks adalah:\n' +
      '1) Paragraf 1: Cara hewan berkembang biak (terbagi dua: generatif dan vegetatif)\n' +
      '2) Paragraf 2: Perkembangbiakan hewan secara generatif (ovipar, vivipar, ovovivipar)\n' +
      '3) Paragraf 3: Contoh hewan yang berkembang biak secara generatif\n' +
      '4) Paragraf 4: Perkembangbiakan hewan secara vegetatif\n' +
      '5) Paragraf 5: Contoh hewan yang berkembang biak secara vegetatif.\n' +
      'Bagan alir yang tepat sesuai urutan paragraf teks adalah Pilihan C.',
  },
  {
    questionId: 'bindo_2_q05',
    originalNumber: 5,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C (cacing pipih, paramecium)',
    topicLabel: 'Informasi Tersurat Teks Eksplanasi',
    discussion:
      'Berdasarkan paragraf ke-5: "Ada beberapa contoh hewan yang berkembang biak secara vegetatif. Amoeba dan paramecium berkembang biak dengan cara membelah diri. Cacing pipih berkembang biak dengan cara fragmentasi. Hydra berkembang biak dengan cara bertunas." Sedangkan ikan pari berkembang biak secara generatif (ovovivipar). Maka jawaban benar adalah A (cacing pipih) dan C (paramecium).',
  },
  {
    questionId: 'bindo_2_q06',
    originalNumber: 6,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (pentingnya menjaga kesehatan tulang)',
    topicLabel: 'Menentukan Ide Pokok Paragraf Deduktif',
    discussion:
      'Kalimat utama paragraf terletak di awal (deduktif): "Menjaga kesehatan tulang sangatlah penting bagi tubuh manusia." Kalimat-kalimat berikutnya menjelaskan manfaat tulang sehat, dampak tanpa perawatan, dan cara merawatnya. Maka ide pokoknya adalah pentingnya menjaga kesehatan tulang (Pilihan A).',
  },
  {
    questionId: 'bindo_2_q07',
    originalNumber: 7,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: true, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Benar · B: Benar · C: Salah',
    topicLabel: 'Kesesuaian Pernyataan dengan Isi Paragraf',
    discussion:
      '• Pernyataan A (Benar): Sesuai kalimat kedua, "Tulang yang sehat mampu melindungi organ vital dan mendukung gerakan tubuh."\n' +
      '• Pernyataan B (Benar): Sesuai kalimat keempat, "Mengonsumsi kalsium dan vitamin D serta rutin berolahraga merupakan beberapa cara untuk menjaga kesehatan tulang."\n' +
      '• Pernyataan C (Salah): Tulang yang tidak dirawat justru menjadi rapuh dan meningkatkan (bukan menurunkan) risiko osteoporosis.',
  },
  {
    questionId: 'bindo_2_q08',
    originalNumber: 8,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C',
    topicLabel: 'Menemukan Informasi Spesifik Teks Informasi',
    discussion:
      'Berdasarkan teks ciri buah melon manis dan matang:\n' +
      '• Pilihan A (BENAR): "jaring-jaring pada kulit terlihat jelas, rapat, kasar, dan berwarna cokelat".\n' +
      '• Pilihan B (SALAH): Melon yang matang terasa lebih berat dari ukurannya (bukan lebih ringan).\n' +
      '• Pilihan C (BENAR): "bagian tangkai sudah kering, berwarna kecokelatan, bahkan mudah lepas".',
  },
  {
    questionId: 'bindo_2_q09',
    originalNumber: 9,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (Kiki)',
    topicLabel: 'Tokoh Utama Teks Cerita Anak',
    discussion:
      'Cerita "Lomba Melukis" berfokus pada pengalaman, pikiran, konflik batin, dan perubahan sikap tokoh Kiki sejak awal pengumuman lomba hingga selesai perlombaan. Oleh karena itu tokoh utamanya adalah Kiki (Pilihan C).',
  },
  {
    questionId: 'bindo_2_q10',
    originalNumber: 10,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (Kiki yang suka menunda-nunda pekerjaan menjadi lebih disiplin.)',
    topicLabel: 'Perubahan Karakter Tokoh dalam Cerita',
    discussion:
      'Pada awal hingga pertengahan cerita, Kiki selalu menunda melukis demi mengejar kupu-kupu, membaca cerita, dan bermain bola. Di akhir cerita tertulis: "Namun, sejak hari itu ia berubah. Ia tidak lagi suka menunda pekerjaan. Setiap ada tugas dari sekolah maupun kegiatan lain, ia selalu mengerjakannya tepat waktu." Artinya ia berubah menjadi lebih disiplin (Pilihan B).',
  },
  {
    questionId: 'bindo_2_q11',
    originalNumber: 11,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (Menunda-nunda pekerjaan menyebabkan Kiki kalah dalam lomba melukis.)',
    topicLabel: 'Menyimpulkan Hubungan Sebab-Akibat dalam Cerita',
    discussion:
      'Kesimpulan inti dari keseluruhan peristiwa dalam cerita adalah kebiasaan Kiki menunda-nunda waktu melukis membuatnya terburu-buru pada malam terakhir sehingga lukisannya tidak selesai dan tidak masuk daftar pemenang (kalah dalam lomba melukis) — Pilihan D.',
  },
  {
    questionId: 'bindo_2_q12',
    originalNumber: 12,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (Sebaiknya kita tidak mudah percaya kepada orang yang belum kita kenal.)',
    topicLabel: 'Amanat / Pesan Moral Cerita Dongeng',
    discussion:
      'Dalam cerita "Pangeran yang Ramah", Pangeran Gibran langsung menerima ajakan dan meminum air pemberian seorang pengemis yang baru dikenalnya di hutan, yang ternyata penyihir jahat. Di akhir paragraf ditegaskan: "Ia menyesal karena terlalu mudah percaya pada orang asing yang baru dikenalnya." Maka amanatnya adalah Pilihan C.',
  },
  {
    questionId: 'bindo_2_q13',
    originalNumber: 13,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: true, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Sesuai · B: Sesuai · C: Tidak Sesuai',
    topicLabel: 'Menilai Kesesuaian Nilai-Nilai Cerita dengan Kehidupan',
    discussion:
      '• Pernyataan A (Sesuai): Menolong tetangga yang kesulitan mencerminkan sifat ramah dan suka menolong yang patut dicontoh dari Pangeran Gibran.\n' +
      '• Pernyataan B (Sesuai): Menolak pemberian makanan/minuman dari orang asing merupakan bentuk kewaspadaan yang sejalan dengan pelajaran dari kesalahan Pangeran Gibran.\n' +
      '• Pernyataan C (Tidak Sesuai): Menerima ajakan orang yang baru dikenal sangat berbahaya dan justru mengulangi kesalahan Pangeran Gibran.',
  },
  {
    questionId: 'bindo_2_q14',
    originalNumber: 14,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (Leo yang dulunya tangguh kini menjadi singa tua yang tidak berdaya.)',
    topicLabel: 'Perubahan Keadaan Tokoh dalam Fabel',
    discussion:
      'Pada awal fabel digambarkan Leo dahulu adalah singa raja hutan yang gagah, kuat, dan cepat. Namun seiring bertambahnya usia, tenaganya melemah, tubuhnya kurus, langkahnya gontai, dan ia tidak sanggup berburu lagi. Jadi perubahan pada tokoh Leo adalah dari singa tangguh menjadi singa tua yang tidak berdaya (Pilihan B).',
  },
  {
    questionId: 'bindo_2_q15',
    originalNumber: 15,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C (pantang menyerah, kerja sama)',
    topicLabel: 'Keteladanan Tokoh dalam Cerita Inspiratif',
    discussion:
      'Berdasarkan teks tentang Sandi dan kelompoknya:\n' +
      '• Pantang menyerah (A — BENAR): "Meskipun sulit, Sandi tidak mudah menyerah. Ia dan kelompoknya mencoba lagi..."\n' +
      '• Mandiri tanpa bantuan (B — SALAH): Sandi bekerja bersama kelompoknya dan meminta petunjuk guru pembimbing.\n' +
      '• Kerja sama (C — BENAR): "Dengan kerja sama dan ketekunan mereka, rangkaian pun berhasil menyala dengan sempurna."',
  },
  {
    questionId: 'bindo_2_q16',
    originalNumber: 16,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['B', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B, C',
    topicLabel: 'Perubahan Latar Suasana dalam Cerita',
    discussion:
      '• Pada awal cerita: "Malam itu begitu cerah" dan "suasana menjadi semakin ramai".\n' +
      '• Ketika awan hitam datang dan hujan turun: "Cahaya bulan tertutup mendung tebal" (malam cerah menjadi kelabu — Pilihan B BENAR) dan "Halaman rumah yang tadinya penuh canda tawa kini berubah sepi" (suasana ramai menjadi sepi — Pilihan C BENAR).\n' +
      '• Pilihan A salah karena di dalam rumah mereka berkumpul hangat sambil menikmati teh manis dan jagung rebus, bukan menjadi dingin dan sepi.',
  },
  {
    questionId: 'bindo_2_q17',
    originalNumber: 17,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (lebih bertanggung jawab dan selalu bekerja sama dengan baik)',
    topicLabel: 'Memprediksi Kelanjutan Sikap Tokoh',
    discussion:
      'Setelah ditegur dengan lembut oleh Pak Guru dan diajak bekerja bersama oleh Rina, Bima menyadari kesalahannya, meminta maaf, dan mulai membantu membuat bagian planet dengan penuh semangat. Oleh karena itu pada tugas kelompok berikutnya Bima akan lebih bertanggung jawab dan selalu bekerja sama dengan baik (Pilihan B).',
  },
  {
    questionId: 'bindo_2_q18',
    originalNumber: 18,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (jujur)',
    topicLabel: 'Menentukan Watak Tokoh Berdasarkan Dialog',
    discussion:
      'Ketika Pak Guru bertanya apakah semua anggota sudah bekerja sama, Rina berkata apa adanya: "Sebenarnya Bima belum banyak membantu, Pak. Tapi kami ingin menyelesaikannya bersama." Sikap menyampaikan kenyataan dengan sopan dan tanpa berbohong menunjukkan watak jujur (Pilihan A).',
  },
  {
    questionId: 'bindo_2_q19',
    originalNumber: 19,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'B'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, B',
    topicLabel: 'Mengaitkan Peristiwa Cerita dengan Kehidupan Sehari-hari',
    discussion:
      '• Pernyataan A (BENAR): Bima yang awalnya asyik mengobrol dan bermain pensil saat kerja kelompok sering dijumpai dalam kegiatan belajar kelompok sehari-hari.\n' +
      '• Pernyataan B (BENAR): Sikap Rina yang ramah merangkul dan mengajak temannya membagi tugas juga merupakan perilaku nyata yang baik di sekolah.\n' +
      '• Pernyataan C (SALAH): Di dalam cerita tidak ada peristiwa Pak Guru menghukum Bima keluar kelas; Pak Guru justru menasihati dengan lembut.',
  },
  {
    questionId: 'bindo_2_q20',
    originalNumber: 20,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (angkat tangan)',
    topicLabel: 'Makna Ungkapan (Idiom) Bahasa Indonesia',
    discussion:
      'Ungkapan "angkat tangan" bermakna menyerah atau tidak sanggup lagi menyelesaikan sesuatu. Karena dalam kalimat terdapat kata "tidak", maka "Raka tidak angkat tangan meskipun soal matematika itu sangat sulit" bermakna Raka tidak menyerah / pantang menyerah (Pilihan D). (Catatan: ringan tangan = suka menolong/cekatan, panjang tangan = suka mencuri, buah tangan = oleh-oleh).',
  },
  {
    questionId: 'bindo_2_q21',
    originalNumber: 21,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'C',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'C (Bagan C)',
    topicLabel: 'Urutan Bagan Alir Teks Prosedur',
    discussion:
      'Berdasarkan teks prosedur "Cara Membuat Telur Asin", urutan langkah yang benar adalah:\n' +
      '1) Menyiapkan alat dan bahan\n' +
      '2) Merendam telur di dalam air bersih sekitar dua menit (untuk menguji kelayakan telur)\n' +
      '3) Membersihkan telur dengan sabun dan spons hingga bersih lalu dikeringkan\n' +
      '4) Membuat larutan perendam dengan melarutkan garam ke dalam air\n' +
      '5) Merendam telur di larutan garam selama 10–12 hari di dalam stoples tertutup\n' +
      '6) Merebus telur dengan api kecil hingga matang (sekitar 1 jam).\n' +
      'Urutan bagan yang sesuai adalah Pilihan C.',
  },
  {
    questionId: 'bindo_2_q22',
    originalNumber: 22,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'B',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'B (tidak bagus untuk dibuat telur asin)',
    topicLabel: 'Inferensi Sebab-Akibat pada Teks Prosedur',
    discussion:
      'Pada langkah pertama teks tertulis: "Perhatikan saat merendam, jika telur mengapung, artinya telur tersebut tidak bagus." Dengan demikian apabila telur bebek mengapung di air, artinya kualitas telur tidak bagus untuk dibuat telur asin (Pilihan B).',
  },
  {
    questionId: 'bindo_2_q23',
    originalNumber: 23,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: false, C: false },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Sesuai · B: Tidak Sesuai · C: Tidak Sesuai',
    topicLabel: 'Evaluasi Ketepatan Informasi Teks Prosedur',
    discussion:
      '• Pernyataan A (Sesuai): Pada langkah ke-2 tertulis "Bersihkan telur dengan hati-hati supaya tidak pecah atau retak."\n' +
      '• Pernyataan B (Tidak Sesuai): Untuk telur asin yang lebih masir disarankan merendam hingga 4 minggu (28 hari), bukan lebih sebentar dari 12 hari.\n' +
      '• Pernyataan C (Tidak Sesuai): Pada langkah ke-6 tertulis telur direbus dengan api kecil selama sekitar satu jam, bukan api besar agar cepat matang.',
  },
  {
    questionId: 'bindo_2_q24',
    originalNumber: 24,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'C'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, C (hewan, melihat)',
    topicLabel: 'Kosakata Baku dan Makna Kata dalam Puisi',
    discussion:
      'Dalam puisi "Raja Rimba":\n' +
      '• Kata "satwa" ("Semua satwa menunduk hormat") memiliki arti hewan / binatang.\n' +
      '• Kata "memandang" ("Matanya tajam memandang jauh") memiliki arti melihat dan memperhatikan.\n' +
      'Maka dua kata yang mewakili isi puisi tersebut adalah hewan (A) dan melihat (C).',
  },
  {
    questionId: 'bindo_2_q25',
    originalNumber: 25,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: false, B: false, C: true },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Tidak Setuju · B: Tidak Setuju · C: Setuju',
    topicLabel: 'Menafsirkan Suasana dan Makna Puisi',
    discussion:
      '• Pernyataan A (Tidak Setuju): Puisi menggambarkan suasana rimba yang tenang, damai, penuh wibawa dan rasa hormat, bukan menegangkan karena raja rimba marah.\n' +
      '• Pernyataan B (Tidak Setuju): Raja rimba digambarkan bijak menjaga rimba tetap damai (bait ke-2), bukan kejam dan menakutkan.\n' +
      '• Pernyataan C (Setuju): Kalimat "Semua satwa menunduk hormat" dan "Bijak menjaga rimba tetap damai" menunjukkan rasa kagum dan hormat para satwa kepada pemimpinnya.',
  },
  {
    questionId: 'bindo_2_q26',
    originalNumber: 26,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A',
    topicLabel: 'Menyusun Ikhtisar (Ringkasan) dari Infografis',
    discussion:
      'Infografis berjudul "4 Manfaat Membaca Buku di Era Digital" memuat empat poin utama: 1) Mengurangi stres hingga 68%, 2) Meningkatkan konsentrasi, 3) Menambah wawasan dan empati, serta 4) Menumbuhkan minat baca anak sejak dini. Pilihan A merangkum keempat manfaat tersebut secara lengkap dan akurat.',
  },
  {
    questionId: 'bindo_2_q27',
    originalNumber: 27,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.MULTIPLE_CHOICE_COMPLEX,
    correctOptionId: '',
    correctOptionIds: ['A', 'B'],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A, B',
    topicLabel: 'Membaca Data Visual pada Infografis',
    discussion:
      'Berdasarkan teks pada infografis:\n' +
      '• Pernyataan A (BENAR): Poin 4 menyebutkan "Menumbuhkan minat baca anak sejak dini" karena anak meniru kebiasaan orang tua.\n' +
      '• Pernyataan B (BENAR): Poin 1 menyebutkan "Mengurangi stres hingga 68%" (membaca menenangkan pikiran lebih efektif daripada bermain gawai).\n' +
      '• Pernyataan C (SALAH): Pada poin 2 tertulis jelas membaca fisik membantu fokus "tanpa gangguan notifikasi", bukan menimbulkan gangguan notifikasi.',
  },
  {
    questionId: 'bindo_2_q28',
    originalNumber: 28,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'D',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'D (sawah)',
    topicLabel: 'Mengamati Latar Tempat Berdasarkan Ilustrasi Gambar',
    discussion:
      'Gambar menunjukkan para petani bercaping sedang memanen padi yang menguning, merontokkan bulir padi, dan memasukkannya ke dalam karung di hamparan petak tanaman padi. Latar tempat kegiatan tersebut adalah sawah (Pilihan D).',
  },
  {
    questionId: 'bindo_2_q29',
    originalNumber: 29,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.TRUE_FALSE,
    correctOptionId: '',
    correctOptionIds: [],
    statementKeys: { A: true, B: false, C: true },
    complexScoringRule: ComplexScoringRule.PARTIAL_NO_PENALTY,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A: Setuju · B: Tidak Setuju · C: Setuju',
    topicLabel: 'Menanggapi Kesesuaian Pernyataan dengan Ilustrasi Gambar',
    discussion:
      '• Pernyataan A (Setuju): Tampak beberapa petani berbagi peran (menyabit padi, memukul/merontokkan padi, dan mengumpulkan ke karung) secara gotong royong.\n' +
      '• Pernyataan B (Tidak Setuju): Pada gambar para petani memanen secara tradisional menggunakan sabit dan alat gebot kayu/bambu, bukan mesin modern.\n' +
      '• Pernyataan C (Setuju): Wajah para petani tampak tersenyum cerah bekerja bersama menyambut hasil panen padi yang menguning.',
  },
  {
    questionId: 'bindo_2_q30',
    originalNumber: 30,
    examPackId: BINDO2_PACK_ID,
    questionType: QuestionType.SINGLE_CHOICE,
    correctOptionId: 'A',
    correctOptionIds: [],
    statementKeys: {},
    complexScoringRule: ComplexScoringRule.ALL_EXACT,
    wrongScore: 0,
    weight: 1,
    verified: true,
    answerSummaryLabel: 'A (mampu untuk menahan air laut agar tidak mengikis tanah di garis pantai)',
    topicLabel: 'Menjawab Pertanyaan Mengapa Berdasarkan Teks Eksposisi',
    discussion:
      'Sesuai butir 1) pada teks: "Sebagai tumbuhan yang mampu menahan arus air laut yang mengikis daratan pantai, dengan kata lain tumbuhan mangrove mampu untuk menahan air laut agar tidak mengikis tanah di garis pantai." Pilihan B salah (ikan-ikan kecil, bukan ikan besar di dasar laut), Pilihan C salah (menyerap CO2 dan menghasilkan O2, bukan menyerap CO dan O2), dan Pilihan D salah (bukan mencegah pasang air laut). Maka jawaban yang tepat adalah Pilihan A.',
  },
];

export const BINDO2_ANSWER_KEY_MAP = new Map<string, AnalyzedAnswerKeySeed>(
  BINDO2_ANSWER_KEYS.map((item) => [item.questionId, item])
);

let bindo2SyncQueue: Promise<{ syncedQuestions: number; syncedKeys: number }> =
  Promise.resolve({ syncedQuestions: 0, syncedKeys: 0 });

/**
 * Menyimpan otomatis seluruh 30 soal B.Indo 2.pdf, 18 aset gambar asli, dan 30 kunci jawaban + pembahasan AI
 * ke Cloud Firestore dalam satu batch atomik agar terhindar dari duplikasi write atau bentrokan createdAt.
 */
export function syncBindo2QuestionsAndAnswerKeysToFirestore(params: {
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

    // Fetch live Firestore snapshots so document existence is never stale across consecutive clicks or background syncs
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

    for (const qItem of BINDO2_QUESTIONS) {
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
          verificationNotes: 'Terverifikasi otomatis bersama analisis kunci jawaban AI B.Indo 2.',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        syncedQuestions += 1;
      }
    }

    for (const assetItem of BINDO2_ASSETS) {
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

    for (const keySeed of BINDO2_ANSWER_KEYS) {
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
        action: 'AUTO_SYNC_BINDO2_AI_ANSWER_KEYS',
        targetType: 'examPack',
        targetId: BINDO2_PACK_ID,
        summary: `${logSummaryPrefix} 30 kunci jawaban & pembahasan teranalisis AI untuk ${BINDO2_SOURCE_PDF_NAME}.`,
      });
    }

    return { syncedQuestions, syncedKeys };
  };

  const next = bindo2SyncQueue.catch(() => ({ syncedQuestions: 0, syncedKeys: 0 })).then(run);
  bindo2SyncQueue = next;
  return next;
}
