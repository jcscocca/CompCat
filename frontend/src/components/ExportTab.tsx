type Props = { href: string };

const NOTES = [
  "Counts reflect reported incidents only, within the chosen radius and date range.",
  "Reported incidents can be incomplete, delayed, corrected, or geographically generalized.",
  "This export does not claim safety, risk, or recommended places.",
];

export function ExportTab({ href }: Props) {
  return (
    <div className="mc-panel is-active" role="tabpanel" aria-label="Export">
      <div className="mc-panel-head"><h4>Export session</h4></div>
      <div className="mc-exp">
        <a className="mc-cta" href={href} style={{ alignSelf: "flex-start", textDecoration: "none" }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>
          Download Tableau-ready CSV
        </a>
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
