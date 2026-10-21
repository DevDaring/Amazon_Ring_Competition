// Plain, public page layout for the privacy policy and terms (no app shell, no login).
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-base font-semibold text-muted">DoorVoice</p>
      <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{title}</h1>
      <p className="mt-2 text-base text-muted">Last updated: {updated}</p>
      <div className="mt-8 space-y-6 text-lg leading-relaxed [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:font-semibold [&_a]:text-accent [&_a]:underline">
        {children}
      </div>
    </div>
  )
}
