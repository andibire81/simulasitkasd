import React, { useState } from 'react';
import { ZoomIn, ZoomOut, X, AlertTriangle, RefreshCw } from 'lucide-react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  maxHeightClass?: string;
  caption?: string;
}

/**
 * Displays original PDF visual crops with strict aspect-ratio preservation,
 * resilient network/load error handling, and an interactive high-clarity zoom modal.
 */
export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  maxHeightClass = 'max-h-[420px]',
  caption,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState<1 | 1.5 | 2>(1.5);
  const [hasError, setHasError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  if (!src) return null;

  const resolvedSrc =
    reloadNonce > 0 ? `${src}${src.includes('?') ? '&' : '?'}r=${reloadNonce}` : src;

  if (hasError) {
    return (
      <div className="my-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Gambar soal belum berhasil dimuat</p>
            <p className="text-amber-800 mt-0.5">
              Periksa koneksi internet Anda lalu tekan tombol Muat Ulang Gambar.
            </p>
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setReloadNonce((n) => n + 1);
              }}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Muat Ulang Gambar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="my-3 inline-flex flex-col items-start max-w-full">
        <div className="relative group rounded-lg border border-slate-200 bg-white p-2.5 max-w-full">
          <img
            src={resolvedSrc}
            alt={alt}
            referrerPolicy="no-referrer"
            onError={() => setHasError(true)}
            onClick={() => setIsOpen(true)}
            className={`w-auto max-w-full ${maxHeightClass} object-contain cursor-zoom-in select-none block`}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(true);
            }}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            Perbesar Gambar
          </button>
        </div>
        {caption && <span className="mt-1 text-xs text-slate-500">{caption}</span>}
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-5xl bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 bg-slate-50">
              <span className="text-sm font-semibold text-slate-800 truncate">{alt}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setZoomScale(1)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    zoomScale === 1
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  100%
                </button>
                <button
                  type="button"
                  onClick={() => setZoomScale(1.5)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    zoomScale === 1.5
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ZoomIn className="w-3.5 h-3.5 inline mr-1" />
                  150%
                </button>
                <button
                  type="button"
                  onClick={() => setZoomScale(2)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    zoomScale === 2
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ZoomOut className="w-3.5 h-3.5 inline mr-1" />
                  200%
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="Tutup tampilan gambar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-slate-100 flex items-start justify-center">
              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <img
                  src={resolvedSrc}
                  alt={alt}
                  referrerPolicy="no-referrer"
                  style={{ width: `${Math.round(zoomScale * 100)}%`, maxWidth: 'none' }}
                  className="h-auto object-contain block"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
