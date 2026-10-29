import { QuestionRecord } from '../types/cbt';

export interface TrueFalseLabels {
  trueLabel: string;
  falseLabel: string;
  columnTitle: string;
}

/**
 * Resolves the exact two-column table labels for True/False style CBT questions
 * ("Benar / Salah", "Sesuai / Tidak Sesuai", or "Setuju / Tidak Setuju")
 * based on the question's verbatim instruction and prompt text.
 */
export function getTrueFalseLabels(
  question: Pick<
    QuestionRecord,
    'instructionText' | 'postImageText' | 'postSecondaryImageText' | 'stemText'
  >
): TrueFalseLabels {
  const combined = [
    question.instructionText || '',
    question.postSecondaryImageText || '',
    question.postImageText || '',
  ]
    .join(' ')
    .toLowerCase();

  if (combined.includes('tidak setuju') || combined.includes('setuju')) {
    return {
      trueLabel: 'Setuju',
      falseLabel: 'Tidak Setuju',
      columnTitle: 'Setuju / Tidak Setuju',
    };
  }

  if (combined.includes('tidak sesuai') || combined.includes('sesuai')) {
    return {
      trueLabel: 'Sesuai',
      falseLabel: 'Tidak Sesuai',
      columnTitle: 'Sesuai / Tidak Sesuai',
    };
  }

  return {
    trueLabel: 'Benar',
    falseLabel: 'Salah',
    columnTitle: 'Benar / Salah',
  };
}
