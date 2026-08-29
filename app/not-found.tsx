import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-[13px] text-ink-faint">404</p>
      <h1 className="text-[20px] font-semibold tracking-tight">We could not find that page.</h1>
      <Link
        href="/dashboard"
        className="rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Back to your projects
      </Link>
    </div>
  );
}
