import type { ReactNode } from "react";
import { formatTime } from "../../../shared/time";
import type { ChartWindow } from "../state/statistics";
import { statisticsActivationProps } from "./statisticsInteraction";

export type StatTone = "pb" | "projected" | "unavailable" | "good" | "warn";

export function StatCard({ label, value, detail, tone, title, onOpen, openLabel }: {
  label: string; value: string; detail?: ReactNode; tone?: StatTone; title?: string;
  onOpen?: () => void; openLabel?: string;
}) {
  return (
    <div
      className={`stat-card${tone ? ` tone-${tone}` : ""}`}
      title={title}
      role={onOpen ? "button" : undefined}
      {...statisticsActivationProps<HTMLDivElement>(onOpen, openLabel ?? `${label} ${value}`)}
    >
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

/** Signed seconds; lower times are better, so a negative change reads as faster. */
export function signedSeconds(ms: number): string {
  return `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${(Math.abs(ms) / 1000).toFixed(2)}`;
}

export function deltaTone(ms: number | undefined): "faster" | "slower" | "same" {
  return ms === undefined || ms === 0 ? "same" : ms < 0 ? "faster" : "slower";
}

/** Inline signed change, coloured by whether lower-is-better improved. */
export function Delta({ ms }: { ms: number | undefined }) {
  if (ms === undefined || !Number.isFinite(ms)) return <span className="delta same">—</span>;
  return <span className={`delta ${deltaTone(ms)}`}>{signedSeconds(ms)}</span>;
}

export function DeltaCard({ label, deltaMs, value, detail }: { label: string; deltaMs: number; value: string; detail?: ReactNode }) {
  const tone = deltaTone(deltaMs);
  return <StatCard label={label} value={value} tone={tone === "faster" ? "good" : tone === "slower" ? "warn" : undefined} detail={<><Delta ms={deltaMs} /> {detail}</>} />;
}

export function StatsSection({ id, title, description, actions, className, children }: {
  id: string; title: string; description?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode;
}) {
  const headingId = `stats-${id}`;
  return (
    <section className={`stats-section${className ? ` ${className}` : ""}`} aria-labelledby={headingId}>
      <div className="section-heading">
        <div><h2 id={headingId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  return (
    <div className="statistics-mode" role="group" aria-label={label}>
      {options.map((option) => <button key={option.value} className="ghost" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  );
}

export function ChartWindowSelect({ value, onChange }: { value: ChartWindow; onChange: (window: ChartWindow) => void }) {
  return (
    <label className="field compact">Chart window<select value={value} onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value) as ChartWindow)}>
      <option value={50}>Last 50</option><option value={100}>Last 100</option><option value={250}>Last 250</option><option value="all">All</option>
    </select></label>
  );
}

export function Pagination({ page, lastPage, onPageChange }: { page: number; lastPage: number; onPageChange: (page: number) => void }) {
  if (lastPage <= 0) return null;
  return (
    <div className="row stats-pagination">
      <button className="ghost small" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Previous</button>
      <span className="small dim">Page {page + 1} / {lastPage + 1}</span>
      <button className="ghost small" disabled={page === lastPage} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  );
}

export type SplitSegment = { series: string; label: string; share: number; ms?: number };

/** Proportional bar with a legend; shares need not sum to one. */
export function SplitBar({ label, segments }: { label: string; segments: readonly SplitSegment[] }) {
  return (
    <div className="recognition-split" role="group" aria-label={label}>
      <div className="split-bar">
        {segments.map((segment) => <span key={segment.series} className={segment.series} style={{ width: `${Math.max(0, segment.share) * 100}%` }} />)}
      </div>
      <div className="split-legend">
        {segments.map((segment) => (
          <span key={segment.series}><i className={`swatch ${segment.series}`} />{segment.label}{segment.ms === undefined ? "" : ` ${formatTime(segment.ms)}`} ({(segment.share * 100).toFixed(0)}%)</span>
        ))}
      </div>
    </div>
  );
}
