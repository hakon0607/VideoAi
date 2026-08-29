'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[20px] font-semibold tracking-tight">Something went wrong.</h1>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
        {error.message || 'An unexpected error occurred while rendering this page.'}
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
