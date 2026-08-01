type Props = {
  variant: "mark" | "bust";
  size?: number;
  className?: string;
};

const HEAD = (
  <>
    {/* Soft triangular ears and a wide round head give Tabby a compact game-mascot silhouette. */}
    <path
      d="M29 39 C24 31 22 16 28 11 C38 13 46 22 50 31 Z"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3.4"
      strokeLinejoin="round"
    />
    <path
      d="M91 39 C96 31 98 16 92 11 C82 13 74 22 70 31 Z"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3.4"
      strokeLinejoin="round"
    />
    <path d="M30 31 C28 25 28 20 30 18 C35 20 40 25 43 30 Z" fill="var(--tabby-ear, #dc806b)" />
    <path d="M90 31 C92 25 92 20 90 18 C85 20 80 25 77 30 Z" fill="var(--tabby-ear, #dc806b)" />

    <path
      d="M60 25 C83 25 98 40 97 61 C96 81 81 92 60 92 C39 92 24 81 23 61 C22 40 37 25 60 25 Z"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3.4"
      strokeLinejoin="round"
    />

    {/* Three isolated wedges read as tabby markings without forming a brow or eye mask. */}
    <path d="M45 29 Q50 27 54 29 L52 43 Q49 40 45 29 Z" fill="var(--tabby-stripe, #7c431f)" />
    <path d="M56 27 Q60 26 64 27 L62 44 Q60 47 58 44 Z" fill="var(--tabby-stripe, #7c431f)" />
    <path d="M66 29 Q70 27 75 29 Q71 40 68 43 Z" fill="var(--tabby-stripe, #7c431f)" />
    <ellipse cx="29.5" cy="65" rx="4.5" ry="2.4" fill="var(--tabby-stripe, #7c431f)" />
    <ellipse cx="90.5" cy="65" rx="4.5" ry="2.4" fill="var(--tabby-stripe, #7c431f)" />

    {/* The face stays intentionally flat and icon-like at small sizes. */}
    <ellipse cx="47" cy="62" rx="4.6" ry="7.2" fill="var(--tabby-eye, #352615)" />
    <ellipse cx="73" cy="62" rx="4.6" ry="7.2" fill="var(--tabby-eye, #352615)" />
    <ellipse cx="60" cy="77" rx="12.5" ry="10" fill="var(--tabby-muzzle, #f3d7b2)" />
    <path d="M56 73 Q60 70 64 73 Q63 77 60 78 Q57 77 56 73 Z" fill="var(--tabby-nose, #6f3d28)" />
    <path
      d="M60 78 Q60 83 55 83.5 M60 78 Q60 83 65 83.5"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
    />
  </>
);

const CAP = (
  <g data-part="field-cap">
    {/* A generic CompCat field cap supplies the uniform silhouette without department markings. */}
    <path
      d="M37 34 C40 21 49 16 60 16 C71 16 80 21 83 34 Z"
      fill="var(--tabby-cap, #28577f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M38 32 Q60 39 82 32 L80 40 Q60 45 40 40 Z"
      fill="var(--tabby-cap-band, #173b58)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <path
      d="M34 39 Q60 47 86 39 Q82 47 60 49 Q38 47 34 39 Z"
      fill="var(--tabby-cap-brim, #102f48)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <circle
      cx="60"
      cy="31"
      r="4.5"
      fill="var(--tabby-button, #e1ad42)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="1.6"
    />
    <path
      d="M60 28.5 C58.3 28.5 57.3 29.6 57.3 31 C57.3 32.9 60 34.9 60 34.9 C60 34.9 62.7 32.9 62.7 31 C62.7 29.6 61.7 28.5 60 28.5 Z"
      fill="var(--tabby-badge-mark, #285878)"
    />
    <circle cx="60" cy="31" r=".9" fill="var(--tabby-button, #e1ad42)" />
  </g>
);

const BUST = (
  <>
    {/* Cinnamon tail with simple bands. */}
    <path
      d="M83 109 C92 97 108 96 111 106 C114 116 102 124 91 119 C86 117 83 113 83 109 Z"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3.2"
      strokeLinejoin="round"
    />
    <path d="M100 100 Q106 104 107 110" stroke="var(--tabby-stripe, #7c431f)" strokeWidth="5" fill="none" />
    <path d="M91 103 Q97 108 98 119" stroke="var(--tabby-stripe, #7c431f)" strokeWidth="5" fill="none" />

    {/* A structured navy field jacket reads as case-desk uniform without police insignia. */}
    <path
      d="M28 118 C29 98 39 87 50 83 L60 90 L70 83 C81 87 91 98 92 118 Z"
      fill="var(--tabby-sweater, #32658f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3.2"
      strokeLinejoin="round"
    />
    <path d="M31 100 L48 86 L51 94 L36 106 Z" fill="var(--tabby-jacket-shadow, #183b58)" />
    <path d="M89 100 L72 86 L69 94 L84 106 Z" fill="var(--tabby-jacket-shadow, #183b58)" />
    <circle cx="37" cy="98" r="2.2" fill="var(--tabby-button, #e1ad42)" />
    <circle cx="83" cy="98" r="2.2" fill="var(--tabby-button, #e1ad42)" />
    <path d="M52 88 L60 99 L68 88 L70 118 H50 Z" fill="var(--tabby-shirt, #9bbbd0)" />
    <path
      d="M47 87 L60 100 L50 108 L41 93 Z M73 87 L60 100 L70 108 L79 93 Z"
      fill="var(--tabby-collar, #193f5d)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M57 96 L63 96 L62 102 L65 112 L60 117 L55 112 L58 102 Z"
      fill="var(--tabby-tie, #17344b)"
    />
    <path
      d="M71 106 H84 V116 H71 Z M71 106 L77.5 110 L84 106"
      fill="var(--tabby-jacket-shadow, #183b58)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <circle cx="67" cy="108" r="1.8" fill="var(--tabby-button, #e1ad42)" />
    <circle cx="67" cy="116" r="1.8" fill="var(--tabby-button, #e1ad42)" />
    <ellipse
      cx="45"
      cy="117"
      rx="13"
      ry="8"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3"
    />
    <ellipse
      cx="75"
      cy="117"
      rx="13"
      ry="8"
      fill="var(--tabby-fur, #c9844f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="3"
    />
    <path
      d="M44 114 V119 M49 114 V119 M71 114 V119 M76 114 V119"
      stroke="var(--tabby-stripe, #7c431f)"
      strokeWidth="1.4"
      strokeLinecap="round"
    />

    {HEAD}
    {CAP}

    {/* Cream reporter pad and visible binding make the notebook unmistakable at portrait size. */}
    <path
      d="M35 96 L62 94 L64 122 L37 124 Z"
      fill="var(--tabby-notebook-page, #f2dfbc)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="2.6"
      strokeLinejoin="round"
    />
    <path d="M35 101 L62 99" stroke="var(--tabby-notebook, #273e50)" strokeWidth="4" />
    <path
      d="M41 96 V92 M48 95 V91 M55 95 V91"
      stroke="var(--tabby-button, #e1ad42)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M42 107 L57 106 M42 113 L57 112 M43 119 L56 118"
      stroke="var(--tabby-notebook-line, #8c7255)"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M59 98 L62 87 L66 88 L64 100 Z"
      fill="var(--tabby-pencil, #e0aa3f)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M62 87 L65 83 L66 88 Z" fill="var(--tabby-outline, #3d2918)" />
    <ellipse cx="36" cy="110" rx="6" ry="8" fill="var(--tabby-fur, #c9844f)" transform="rotate(-8 36 110)" />
    <ellipse cx="65" cy="110" rx="6" ry="8" fill="var(--tabby-fur, #c9844f)" transform="rotate(8 65 110)" />

    {/* Generic CompCat map-pin medallion, deliberately not a police badge. */}
    <circle
      cx="78"
      cy="102"
      r="5.5"
      fill="var(--tabby-badge, #e1ad42)"
      stroke="var(--tabby-outline, #3d2918)"
      strokeWidth="1.8"
    />
    <path
      d="M78 98.8 C75.8 98.8 74.5 100.3 74.5 102.1 C74.5 104.6 78 107.2 78 107.2 C78 107.2 81.5 104.6 81.5 102.1 C81.5 100.3 80.2 98.8 78 98.8 Z"
      fill="var(--tabby-badge-mark, #285878)"
    />
    <circle cx="78" cy="102" r="1.2" fill="var(--tabby-badge, #e1ad42)" />
  </>
);

export function TabbyAvatar({ variant, size = 20, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-variant={variant}
      className={className}
      width={size}
      height={size}
      viewBox={variant === "mark" ? "17 7 86 88" : "8 7 104 120"}
      aria-hidden="true"
      focusable="false"
    >
      {variant === "mark" ? (
        <>
          {HEAD}
          {CAP}
        </>
      ) : (
        BUST
      )}
    </svg>
  );
}
