import { Download } from "lucide-react";

type Props = {
  href: string;
};

export function ExportPanel({ href }: Props) {
  return (
    <section className="panel export-panel" aria-labelledby="export-title">
      <h2 id="export-title">Export</h2>
      <p className="muted">Download the current place summary as a Tableau-ready CSV.</p>
      <a className="button-link" href={href}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </a>
    </section>
  );
}
