import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useI18n } from "../../i18n";

export type Tone = "neutral" | "blue" | "green" | "amber" | "red";

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary:
      "border-blue-700 bg-blue-700 text-white hover:border-blue-800 hover:bg-blue-800",
    secondary:
      "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
    ghost:
      "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
    danger:
      "border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50",
  }[variant];

  return (
    <button
      type={type}
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:translate-y-px ${className}`}
      {...props}
    />
  );
}

export function Panel({
  children,
  className = "",
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  const tones: Record<Tone, string> = {
    neutral: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/35",
    green: "border-emerald-200 bg-emerald-50/35",
    amber: "border-amber-200 bg-amber-50/35",
    red: "border-red-200 bg-red-50/35",
  };

  return (
    <div className={`rounded-xl border ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2
          id={id}
          tabIndex={id ? -1 : undefined}
          className="scroll-mt-24 text-2xl font-bold tracking-[-0.025em] text-slate-950 sm:text-[1.75rem]"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Metric({
  label,
  value,
  note,
  emphasis = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <dl className={className}>
      <dt className="text-xs font-semibold leading-5 text-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 font-bold tracking-[-0.025em] text-slate-950 tabular-nums ${emphasis ? "text-3xl" : "text-lg"}`}
      >
        {value}
      </dd>
      {note ? <dd className="mt-0.5 text-xs leading-5 text-slate-500">{note}</dd> : null}
    </dl>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const tones: Record<Tone, string> = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function InlineNotice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const config = {
    neutral: { icon: Info, style: "border-slate-200 bg-slate-50 text-slate-700" },
    blue: { icon: Info, style: "border-blue-200 bg-blue-50 text-blue-800" },
    green: {
      icon: CheckCircle2,
      style: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    amber: {
      icon: TriangleAlert,
      style: "border-amber-200 bg-amber-50 text-amber-900",
    },
    red: { icon: AlertCircle, style: "border-red-200 bg-red-50 text-red-800" },
  }[tone];
  const Icon = config.icon;

  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${config.style}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 leading-5">
        {title ? <p className="font-bold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-8 rounded-md px-3 text-sm font-semibold transition ${
            option.value === value
              ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const descriptionId = hint || error ? `${generatedId}-description` : undefined;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      aria-invalid={error ? true : undefined}
      className={`grid content-start gap-1.5 ${className}`}
    >
      <span id={labelId} className="text-xs font-bold text-slate-700">{label}</span>
      {children}
      {hint || error ? (
        <span id={descriptionId} className={error ? "text-xs font-medium text-red-700" : "text-xs leading-5 text-slate-500"}>
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}

export const controlClassName =
  "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-[0_1px_1px_rgba(15,23,42,0.03)] transition hover:border-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

export function EmptyValue({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <span className="font-medium text-slate-400">{children ?? t("common.notAvailable")}</span>;
}
