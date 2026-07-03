type Props = { href: string };

const NOTES = [
  "Counts reflect reported incidents only, within the chosen radius and date range.",
  "Reported incidents can be incomplete, delayed, corrected, or geographically generalized.",
  "This export does not claim safety, risk, or recommended places.",
];

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>
  );
}

export function ExportTab({ href }: Props) {
  const links = [{ label: "Place summary CSV", href }];
  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Export">
      <div className="mc-panel-head"><h4>Export session</h4></div>
      <div className="mc-exp">
        {links.map((link) => (
          <a
            key={link.href}
            className="mc-cta"
            href={link.href}
            style={{ alignSelf: "flex-start", textDecoration: "none" }}
          >
            <DownloadIcon />
            {link.label}
          </a>
        ))}
        <ul className="mc-explist">
          {NOTES.map((note) => (
            <li key={note}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
