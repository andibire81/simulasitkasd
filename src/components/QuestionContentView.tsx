import React from 'react';
import { QuestionRecord } from '../types/cbt';
import { MathText } from './MathText';
import { ZoomableImage } from './ZoomableImage';

interface QuestionContentViewProps {
  question: QuestionRecord;
}

/**
 * Renders the exact multi-part stem & original PDF graphics sequence of a question
 * (stemText -> primary imageUrls -> postImageText -> secondaryImageUrls -> postSecondaryImageText).
 */
export const QuestionContentView: React.FC<QuestionContentViewProps> = ({ question }) => {
  return (
    <div className="space-y-3 text-slate-900 text-base leading-relaxed">
      <p className="text-[16px] leading-[1.7] text-slate-900">
        <MathText text={question.stemText} />
      </p>

      {question.imageUrls &&
        question.imageUrls.length > 0 &&
        question.imageUrls.map((url, idx) => (
          <ZoomableImage
            key={`img-1-${idx}`}
            src={url}
            alt={`Gambar Soal Nomor ${question.originalNumber}`}
          />
        ))}

      {question.postImageText && (
        <p className="text-[16px] leading-[1.7] text-slate-900">
          <MathText text={question.postImageText} />
        </p>
      )}

      {question.secondaryImageUrls &&
        question.secondaryImageUrls.length > 0 &&
        question.secondaryImageUrls.map((url, idx) => (
          <ZoomableImage
            key={`img-2-${idx}`}
            src={url}
            alt={`Ilustrasi Tambahan Soal Nomor ${question.originalNumber}`}
          />
        ))}

      {question.postSecondaryImageText && (
        <p className="text-[16px] leading-[1.7] text-slate-900">
          <MathText text={question.postSecondaryImageText} />
        </p>
      )}
    </div>
  );
};
