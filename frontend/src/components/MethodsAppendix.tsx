import { useId, useState } from "react";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

export function MethodsAppendix({ openId }: { openId?: string }) {
  const [open, setOpen] = useState<boolean>(false);
  const panelId = useId();
  const headingId = `${panelId}-heading`;
  return (
    <div className="mc-methods">
      <button
        type="button"
        className="mc-methods-btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        ⓘ Methods
      </button>
      {open ? (
        <section className="mc-methods-sheet" id={panelId} aria-labelledby={headingId}>
          <div className="mc-methods-head">
            <h4 id={headingId}>Methods &amp; definitions</h4>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="mc-methods-body">
            {METHODS_DEFINITIONS.map((def) => (
              <div className="mc-method" id={`method-${def.id}`} key={def.id}
                   data-highlight={def.id === openId ? "true" : undefined}>
                <div className="mc-method-term">{def.term} <span>{def.shownAs}</span></div>
                <p>{def.plain}</p>
                <p className="mc-method-read">{def.howToRead}</p>
                {def.formula ? <code>{def.formula}</code> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
