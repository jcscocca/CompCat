type Props = {
  variant: "mark" | "bust";
  size?: number;
  className?: string;
};

const HEAD = (
  <>
    <path d="M31 50 L26 20 L54 34 Z" fill="#b5793f" />
    <path d="M89 50 L94 20 L66 34 Z" fill="#b5793f" />
    <path d="M34 44 L31 27 L48 36 Z" fill="#6b4520" />
    <path d="M86 44 L89 27 L72 36 Z" fill="#6b4520" />
    <circle cx="60" cy="62" r="30" fill="#b5793f" />
    <path d="M53 34 Q54 41 52 46" stroke="#8a5a2e" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    <path d="M60 33 L60 45" stroke="#8a5a2e" strokeWidth="3.4" strokeLinecap="round" />
    <path d="M67 34 Q66 41 68 46" stroke="#8a5a2e" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    <path d="M32 56 L41 58" stroke="#8a5a2e" strokeWidth="3" strokeLinecap="round" />
    <path d="M88 56 L79 58" stroke="#8a5a2e" strokeWidth="3" strokeLinecap="round" />
    <circle cx="49" cy="58" r="3.6" fill="#2f6c4f" />
    <circle cx="71" cy="58" r="3.6" fill="#2f6c4f" />
    <circle cx="49" cy="58" r="1.5" fill="#1c1c1a" />
    <circle cx="71" cy="58" r="1.5" fill="#1c1c1a" />
    <ellipse cx="60" cy="72" rx="12" ry="9" fill="#e2c495" />
    <path d="M56.5 68.5 L63.5 68.5 L60 73 Z" fill="#8a4b3a" />
    <path d="M60 73 Q60 77 55 77.5" stroke="#6b4520" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <path d="M60 73 Q60 77 65 77.5" stroke="#6b4520" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <path d="M47 70 Q39 68 32 67" stroke="#e2c495" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M47 74 Q39 75 33 76" stroke="#e2c495" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M73 70 Q81 68 88 67" stroke="#e2c495" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M73 74 Q81 75 87 76" stroke="#e2c495" strokeWidth="1.5" fill="none" strokeLinecap="round" />
  </>
);

const MARK = HEAD;

const BUST = (
  <>
    <path d="M28 102 Q34 84 48 80 L60 86 L72 80 Q86 84 92 102 Z" fill="#9c6630" />
    <polygon points="60,86 54,93 60,100 66,93" fill="#e2c495" />
    <path d="M47 82 Q60 91 73 82 L73 87 Q60 96 47 87 Z" fill="#2f6c4f" />
    <circle cx="60" cy="93" r="3.2" fill="#d9b036" />
    {HEAD}
  </>
);

export function TabbyAvatar({ variant, size = 20, className }: Props) {
  return (
    <svg
      data-variant={variant}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      {variant === "mark" ? MARK : BUST}
    </svg>
  );
}
