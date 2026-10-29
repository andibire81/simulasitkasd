import React from 'react';

interface MathTextProps {
  text: string;
  className?: string;
}

const FRAC_REGEX = /\[\[frac:([^:\]]+):([^\]]+)\]\]/g;

/**
 * Renders verbatim question text while formatting [[frac:num:den]] tokens
 * as crisp stacked mathematical fractions identical to the PDF layout.
 */
export const MathText: React.FC<MathTextProps> = ({ text, className = '' }) => {
  if (!text) return null;

  const lines = text.split('\n');

  return (
    <span className={className}>
      {lines.map((line, lineIdx) => {
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        FRAC_REGEX.lastIndex = 0;

        while ((match = FRAC_REGEX.exec(line)) !== null) {
          if (match.index > lastIndex) {
            parts.push(line.slice(lastIndex, match.index));
          }
          const numerator = match[1];
          const denominator = match[2];
          parts.push(
            <span
              key={`frac-${lineIdx}-${match.index}`}
              className="inline-flex flex-col items-center justify-center align-middle mx-1 px-1 leading-none font-mono-tabular"
              aria-label={`${numerator} per ${denominator}`}
            >
              <span className="border-b border-current px-1 pb-0.5 text-[0.92em]">
                {numerator}
              </span>
              <span className="px-1 pt-0.5 text-[0.92em]">{denominator}</span>
            </span>
          );
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < line.length) {
          parts.push(line.slice(lastIndex));
        }

        return (
          <React.Fragment key={lineIdx}>
            {parts}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </span>
  );
};
