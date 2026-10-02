import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  pressed?: boolean;
}

export function IconButton({ label, pressed, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon strokeWidth={1.5} />
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {children}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-checked={optionValue === value}
          onClick={() => onChange(optionValue)}
        >
          {Icon && <Icon />}
          {optionLabel}
        </button>
      ))}
    </div>
  );
}
