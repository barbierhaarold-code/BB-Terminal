export function ComingSoon({ label, note }: { label: string; note: string }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center flex flex-col gap-2">
        <div className="text-term-amber text-[11px] tracking-[0.25em] font-bold">{label} — NOT YET BUILT</div>
        <div className="text-term-muted text-[12px] leading-relaxed">{note}</div>
      </div>
    </div>
  );
}
