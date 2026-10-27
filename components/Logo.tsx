export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`} aria-label="GROOVED">
      <svg className="vinyl-logo" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" strokeWidth="1" opacity=".8" />
        <circle cx="32" cy="32" r="12" fill="currentColor" />
        <circle cx="32" cy="32" r="3" fill="var(--ink)" />
      </svg>
      {!compact && (
        <div>
          <div className="brand-name">GROOVED</div>
        </div>
      )}
    </div>
  );
}
