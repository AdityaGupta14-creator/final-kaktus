'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CircuitBoard, Monitor, Smartphone } from 'lucide-react';

function MobileWorkspaceNotice() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const continueToWorkspace = () => {
    const requestedPath = searchParams.get('redirect') || '/ide';

    try {
      const destination = new URL(requestedPath, window.location.origin);
      const safePath = destination.origin === window.location.origin && destination.pathname === '/ide'
        ? `${destination.pathname}${destination.search}${destination.hash}`
        : '/ide';
      router.replace(safePath);
    } catch {
      router.replace('/ide');
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-5 py-10 text-neutral-100 sm:px-8 flex items-center justify-center">
      <section className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-[#111214] p-6 shadow-2xl sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-200">
            <CircuitBoard size={19} aria-hidden="true" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-neutral-300">Kaktus Workspace</span>
        </div>

        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-neutral-800 bg-[#0b0c0e] text-neutral-300">
          <Smartphone size={25} aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">Android device detected</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Kaktus works best on a PC</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-400">
          The circuit canvas, firmware editor, terminal, and hardware controls are easier to use on a larger screen. Open Kaktus on a computer for the full experience.
        </p>

        <div className="my-6 flex items-center gap-3 rounded-xl border border-neutral-800 bg-[#0c0d0f] p-4">
          <Monitor size={20} className="shrink-0 text-neutral-300" aria-hidden="true" />
          <p className="text-sm leading-5 text-neutral-400">You can still continue on this Android device if you want.</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={continueToWorkspace}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#111214]"
          >
            Continue to workspace <ArrowRight size={16} aria-hidden="true" />
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function MobileWorkspacePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0a0a0a]" />}>
      <MobileWorkspaceNotice />
    </Suspense>
  );
}
