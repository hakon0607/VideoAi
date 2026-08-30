'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Film,
  Layers,
  Music,
  Scissors,
  ShieldCheck,
  Sparkles,
  Type,
  Wand2,
  Zap,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { LOCALES, LOCALE_LABELS } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils/cn';

/** The public front page. Everything on it is real behaviour of the editor. */
export function LandingView({ signedIn }: { signedIn: boolean }) {
  const { t, locale, setLocale } = useI18n();

  const features = [
    { icon: Wand2, title: t('landing.features.engine.title'), body: t('landing.features.engine.body') },
    { icon: Layers, title: t('landing.features.timeline.title'), body: t('landing.features.timeline.body') },
    { icon: Type, title: t('landing.features.transcribe.title'), body: t('landing.features.transcribe.body') },
    { icon: Zap, title: t('landing.features.export.title'), body: t('landing.features.export.body') },
    { icon: Music, title: t('landing.features.sound.title'), body: t('landing.features.sound.body') },
    { icon: ShieldCheck, title: t('landing.features.team.title'), body: t('landing.features.team.body') },
  ];

  const steps = [
    { icon: Film, title: t('landing.how.step1.title'), body: t('landing.how.step1.body') },
    { icon: Sparkles, title: t('landing.how.step2.title'), body: t('landing.how.step2.body') },
    { icon: Scissors, title: t('landing.how.step3.title'), body: t('landing.how.step3.body') },
  ];

  return (
    <div className="min-h-screen bg-base text-ink">
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-base/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-sm bg-accent text-[11px] font-bold text-white">
              V
            </span>
            VideoAI
          </Link>

          <nav className="hidden flex-1 items-center gap-5 text-[13px] text-ink-muted md:flex">
            <a href="#features" className="transition-colors hover:text-ink">
              {t('landing.nav.features')}
            </a>
            <a href="#how" className="transition-colors hover:text-ink">
              {t('landing.nav.how')}
            </a>
            <a href="#credits" className="transition-colors hover:text-ink">
              {t('landing.nav.pricing')}
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-sm border border-line p-0.5">
              {LOCALES.map((id) => (
                <button
                  key={id}
                  onClick={() => setLocale(id)}
                  className={cn(
                    'rounded-xs px-1.5 py-0.5 text-[11px] transition-colors',
                    locale === id ? 'bg-elevated text-ink' : 'text-ink-faint hover:text-ink-muted',
                  )}
                >
                  {LOCALE_LABELS[id]}
                </button>
              ))}
            </div>
            {!signedIn && (
              <Link
                href="/login"
                className="hidden h-8 items-center rounded-md px-3 text-[13px] text-ink-muted transition-colors hover:text-ink sm:flex"
              >
                {t('landing.nav.login')}
              </Link>
            )}
            <Link
              href={signedIn ? '/dashboard' : '/signup'}
              className="flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {t('landing.nav.start')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero -------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-line/60">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--color-accent), transparent 65%)' }}
        />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11.5px] text-ink-muted">
            <Sparkles size={11} className="text-accent" />
            {t('landing.hero.badge')}
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            {t('landing.hero.title')}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-muted text-pretty">
            {t('landing.hero.subtitle')}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={signedIn ? '/dashboard' : '/signup'}
              className="flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {t('landing.hero.cta')}
              <ArrowRight size={14} />
            </Link>
            <a
              href="#how"
              className="flex h-10 items-center rounded-md border border-line px-5 text-[13.5px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {t('landing.hero.secondary')}
            </a>
          </div>
          <p className="mt-4 text-[12px] text-ink-faint">{t('landing.hero.note')}</p>

          <EditorMock />
        </div>
      </section>

      {/* Features ---------------------------------------------------------- */}
      <section id="features" className="border-b border-line/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('landing.features.title')}</h2>
          <p className="mt-2 text-[14px] text-ink-muted">{t('landing.features.subtitle')}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <article
                key={title}
                className="rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong"
              >
                <span className="grid h-8 w-8 place-items-center rounded-md bg-accent-soft text-accent">
                  <Icon size={15} />
                </span>
                <h3 className="mt-3.5 text-[14px] font-medium text-ink">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How --------------------------------------------------------------- */}
      <section id="how" className="border-b border-line/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('landing.how.title')}</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {steps.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="rounded-lg border border-line bg-surface p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-line text-[12px] text-ink-muted">
                    {index + 1}
                  </span>
                  <Icon size={15} className="text-accent" />
                </div>
                <h3 className="mt-3.5 text-[14px] font-medium text-ink">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Credits ----------------------------------------------------------- */}
      <section id="credits" className="border-b border-line/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('landing.credits.title')}</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{t('landing.credits.body')}</p>
          </div>
          <ul className="space-y-2.5 self-center">
            {[t('landing.credits.item1'), t('landing.credits.item2'), t('landing.credits.item3')].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13.5px] text-ink-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-positive" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA --------------------------------------------------------------- */}
      <section className="border-b border-line/60">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('landing.cta.title')}</h2>
          <p className="mt-2 text-[14px] text-ink-muted">{t('landing.cta.body')}</p>
          <Link
            href={signedIn ? '/dashboard' : '/signup'}
            className="mt-7 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {t('landing.hero.cta')}
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-[12px] text-ink-faint">
        <span>© {new Date().getFullYear()} VideoAI</span>
        <span>{t('landing.footer.built')}</span>
      </footer>
    </div>
  );
}

/**
 * A miniature of the editor that plays out one real request. The steps are the
 * ones the assistant actually reports while it works.
 */
function EditorMock() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const steps = [
    t('landing.demo.step1'),
    t('landing.demo.step2'),
    t('landing.demo.step3'),
    t('landing.demo.step4'),
  ];

  useEffect(() => {
    const timer = window.setInterval(() => setStep((s) => (s + 1) % (steps.length + 1)), 1900);
    return () => window.clearInterval(timer);
  }, [steps.length]);

  const lanes = [
    { color: 'var(--color-track-video)', blocks: [[0, 26], [28, 22], [52, 30], [84, 16]] },
    { color: 'var(--color-track-text)', blocks: [[4, 14], [34, 12], [60, 18]] },
    { color: 'var(--color-track-audio)', blocks: [[0, 100]] },
    { color: 'var(--color-track-overlay)', blocks: [[26, 4], [50, 4], [82, 4]] },
  ];

  return (
    <div className="mx-auto mt-14 max-w-4xl overflow-hidden rounded-xl border border-line bg-surface text-left shadow-pop">
      <div className="flex h-8 items-center gap-1.5 border-b border-line px-3">
        <span className="h-2 w-2 rounded-full bg-danger/70" />
        <span className="h-2 w-2 rounded-full bg-warning/70" />
        <span className="h-2 w-2 rounded-full bg-positive/70" />
        <span className="ml-2 text-[11px] text-ink-faint">baking-with-friends.mp4</span>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-[1fr_260px]">
        <div className="bg-base p-4">
          <div className="grid aspect-video place-items-center rounded-md border border-line bg-elevated">
            <span className="text-[11.5px] text-ink-faint">{t('editor.preview')}</span>
          </div>

          <div className="mt-3 space-y-1.5 rounded-md border border-line bg-surface p-2.5">
            {lanes.map((lane, index) => (
              <div key={index} className="relative h-4 overflow-hidden rounded-xs bg-elevated">
                {lane.blocks.map(([left, width], blockIndex) => (
                  <span
                    key={blockIndex}
                    className="absolute inset-y-0 rounded-xs transition-opacity duration-700"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: lane.color,
                      opacity: step === 0 ? 0.35 : 0.85,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface p-4">
          <div className="rounded-md rounded-br-xs bg-accent px-3 py-2 text-[12.5px] text-white">
            {t('landing.demo.prompt')}
          </div>
          <ul className="mt-3 space-y-2">
            {steps.map((line, index) => (
              <li
                key={line}
                className={cn(
                  'flex gap-2 text-[12px] leading-relaxed transition-all duration-500',
                  index < step ? 'text-ink-muted opacity-100' : 'text-ink-faint opacity-30',
                )}
              >
                {index < step ? (
                  <Check size={12} className="mt-0.5 shrink-0 text-positive" />
                ) : (
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                )}
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
