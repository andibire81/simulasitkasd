import {
  AnswerKeyRecord,
  ComplexScoringRule,
  QuestionRecord,
  QuestionType,
  ResponseRecord,
} from '../types/cbt';

export interface QuestionGradeDetail {
  questionId: string;
  originalNumber: number;
  questionType: QuestionType;
  keyVerified: boolean;
  isAnswered: boolean;
  outcome: 'correct' | 'partial' | 'wrong' | 'unanswered' | 'unverified_key';
  earnedScore: number;
  maxWeight: number;
}

export interface AttemptGradingResult {
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  rawScore: number;
  maxScore: number;
  finalScore: number;
  gradingStatus: 'graded_complete' | 'graded_partial' | 'ungraded_missing_keys';
  unverifiedKeyCount: number;
  details: QuestionGradeDetail[];
}

export function isResponseAnswered(
  question: QuestionRecord,
  response?: ResponseRecord | null
): boolean {
  if (!response) return false;
  if (question.questionType === QuestionType.SINGLE_CHOICE) {
    return Boolean(response.selectedOptionId && response.selectedOptionId.trim().length > 0);
  }
  if (question.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX) {
    return Array.isArray(response.selectedOptionIds) && response.selectedOptionIds.length > 0;
  }
  if (question.questionType === QuestionType.TRUE_FALSE) {
    if (!response.statementAnswers) return false;
    return question.statements.some(
      (st) =>
        response.statementAnswers[st.id] === 'true' ||
        response.statementAnswers[st.id] === 'false'
    );
  }
  return false;
}

/**
 * Grades a student attempt strictly using admin-verified answer keys.
 * Questions whose answer keys are missing or unverified are NEVER guessed;
 * they are flagged as 'unverified_key' so admins receive explicit warnings.
 */
export function evaluateAttemptGrades(params: {
  questions: QuestionRecord[];
  responsesByQuestionId: Record<string, ResponseRecord | undefined>;
  answerKeysByQuestionId: Record<string, AnswerKeyRecord | undefined>;
}): AttemptGradingResult {
  const { questions, responsesByQuestionId, answerKeysByQuestionId } = params;

  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  let rawScore = 0;
  let maxScore = 0;
  let unverifiedKeyCount = 0;
  const details: QuestionGradeDetail[] = [];

  const sortedQuestions = [...questions].sort((a, b) => a.originalNumber - b.originalNumber);

  for (const q of sortedQuestions) {
    const resp = responsesByQuestionId[q.id];
    const answered = isResponseAnswered(q, resp);
    const key = answerKeysByQuestionId[q.id];
    const weight = key && key.weight > 0 ? key.weight : q.weight > 0 ? q.weight : 1;

    if (!answered) {
      unansweredCount += 1;
    }

    if (!key || !key.verified) {
      unverifiedKeyCount += 1;
      details.push({
        questionId: q.id,
        originalNumber: q.originalNumber,
        questionType: q.questionType,
        keyVerified: false,
        isAnswered: answered,
        outcome: 'unverified_key',
        earnedScore: 0,
        maxWeight: weight,
      });
      continue;
    }

    maxScore += weight;

    if (!answered || !resp) {
      details.push({
        questionId: q.id,
        originalNumber: q.originalNumber,
        questionType: q.questionType,
        keyVerified: true,
        isAnswered: false,
        outcome: 'unanswered',
        earnedScore: 0,
        maxWeight: weight,
      });
      continue;
    }

    if (q.questionType === QuestionType.SINGLE_CHOICE) {
      const isCorrect = resp.selectedOptionId === key.correctOptionId && key.correctOptionId !== '';
      const earned = isCorrect ? weight : key.wrongScore || 0;
      rawScore += earned;
      if (isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }
      details.push({
        questionId: q.id,
        originalNumber: q.originalNumber,
        questionType: q.questionType,
        keyVerified: true,
        isAnswered: true,
        outcome: isCorrect ? 'correct' : 'wrong',
        earnedScore: Number(earned.toFixed(2)),
        maxWeight: weight,
      });
      continue;
    }

    if (q.questionType === QuestionType.MULTIPLE_CHOICE_COMPLEX) {
      const expectedSet = new Set(key.correctOptionIds || []);
      const chosenSet = new Set(resp.selectedOptionIds || []);

      const isExactMatch =
        expectedSet.size > 0 &&
        expectedSet.size === chosenSet.size &&
        [...expectedSet].every((id) => chosenSet.has(id));

      if (key.complexScoringRule === ComplexScoringRule.ALL_EXACT) {
        const earned = isExactMatch ? weight : 0;
        rawScore += earned;
        if (isExactMatch) correctCount += 1;
        else wrongCount += 1;

        details.push({
          questionId: q.id,
          originalNumber: q.originalNumber,
          questionType: q.questionType,
          keyVerified: true,
          isAnswered: true,
          outcome: isExactMatch ? 'correct' : 'wrong',
          earnedScore: Number(earned.toFixed(2)),
          maxWeight: weight,
        });
      } else {
        // PARTIAL_NO_PENALTY: if student picked any wrong option, score 0 (preventing select-all exploit);
        // otherwise proportional to correct options chosen out of expectedSet.size.
        const hasWrongChoice = [...chosenSet].some((id) => !expectedSet.has(id));
        if (hasWrongChoice || expectedSet.size === 0) {
          wrongCount += 1;
          details.push({
            questionId: q.id,
            originalNumber: q.originalNumber,
            questionType: q.questionType,
            keyVerified: true,
            isAnswered: true,
            outcome: 'wrong',
            earnedScore: 0,
            maxWeight: weight,
          });
        } else if (isExactMatch) {
          rawScore += weight;
          correctCount += 1;
          details.push({
            questionId: q.id,
            originalNumber: q.originalNumber,
            questionType: q.questionType,
            keyVerified: true,
            isAnswered: true,
            outcome: 'correct',
            earnedScore: Number(weight.toFixed(2)),
            maxWeight: weight,
          });
        } else {
          const hitCount = [...chosenSet].filter((id) => expectedSet.has(id)).length;
          const earned = (hitCount / expectedSet.size) * weight;
          rawScore += earned;
          // Count partial separately from full correct; not wrong if >0 earned
          if (hitCount === 0) wrongCount += 1;
          details.push({
            questionId: q.id,
            originalNumber: q.originalNumber,
            questionType: q.questionType,
            keyVerified: true,
            isAnswered: true,
            outcome: hitCount > 0 ? 'partial' : 'wrong',
            earnedScore: Number(earned.toFixed(2)),
            maxWeight: weight,
          });
        }
      }
      continue;
    }

    if (q.questionType === QuestionType.TRUE_FALSE) {
      const statements = q.statements || [];
      if (statements.length === 0) {
        unverifiedKeyCount += 1;
        continue;
      }
      let matchedStatements = 0;
      for (const st of statements) {
        const expectedBool = key.statementKeys?.[st.id];
        const studentVal = resp.statementAnswers?.[st.id];
        if (
          typeof expectedBool === 'boolean' &&
          ((expectedBool === true && studentVal === 'true') ||
            (expectedBool === false && studentVal === 'false'))
        ) {
          matchedStatements += 1;
        }
      }

      const allTrueFalseCorrect = matchedStatements === statements.length;
      if (key.complexScoringRule === ComplexScoringRule.ALL_EXACT) {
        const earned = allTrueFalseCorrect ? weight : 0;
        rawScore += earned;
        if (allTrueFalseCorrect) correctCount += 1;
        else wrongCount += 1;
        details.push({
          questionId: q.id,
          originalNumber: q.originalNumber,
          questionType: q.questionType,
          keyVerified: true,
          isAnswered: true,
          outcome: allTrueFalseCorrect ? 'correct' : 'wrong',
          earnedScore: Number(earned.toFixed(2)),
          maxWeight: weight,
        });
      } else {
        const earned = (matchedStatements / statements.length) * weight;
        rawScore += earned;
        if (allTrueFalseCorrect) correctCount += 1;
        else if (matchedStatements === 0) wrongCount += 1;
        details.push({
          questionId: q.id,
          originalNumber: q.originalNumber,
          questionType: q.questionType,
          keyVerified: true,
          isAnswered: true,
          outcome: allTrueFalseCorrect ? 'correct' : matchedStatements > 0 ? 'partial' : 'wrong',
          earnedScore: Number(earned.toFixed(2)),
          maxWeight: weight,
        });
      }
    }
  }

  const finalScore =
    maxScore > 0 ? Math.max(0, Math.min(100, Number(((rawScore / maxScore) * 100).toFixed(2)))) : 0;

  let gradingStatus: AttemptGradingResult['gradingStatus'] = 'graded_complete';
  if (maxScore === 0 || unverifiedKeyCount === sortedQuestions.length) {
    gradingStatus = 'ungraded_missing_keys';
  } else if (unverifiedKeyCount > 0) {
    gradingStatus = 'graded_partial';
  }

  return {
    correctCount,
    wrongCount,
    unansweredCount,
    rawScore: Number(rawScore.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    finalScore,
    gradingStatus,
    unverifiedKeyCount,
    details,
  };
}
