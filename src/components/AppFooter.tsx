import React from 'react';

export const AppFooter: React.FC = () => {
  return (
    <footer className="no-print border-t border-slate-200 bg-white py-6 px-6 text-sm text-slate-600">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">SIMULASI TKA SD — CBT ONLINE</p>
        <p className="text-slate-600">
          Dikembangkan oleh:{' '}
          <span className="font-medium text-slate-900">
            Andi Mozes Leavingstone Bire, S.Pd.
          </span>
        </p>
      </div>
    </footer>
  );
};
