// Inline-SVG иконки: без внешних файлов и шрифтов. Декоративные — подпись даёт обёртка.
import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MicIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Icon>
  );
}

export function MicOffIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      <path d="M4 4l16 16" />
    </Icon>
  );
}

export function CamIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </Icon>
  );
}

export function CamOffIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
      <path d="M3 3l18 18" />
    </Icon>
  );
}

/** Значок предупреждения поверх иконки устройства: доступа нет, устройство занято или пропало. */
export function WarningIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18h0" />
    </Icon>
  );
}
