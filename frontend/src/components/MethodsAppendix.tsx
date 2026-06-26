import { useState } from "react";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

export function MethodsAppendix({ openId }: { openId?: string }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="mc-methods">
      <button type="button" className="mc-methods-btn" onClick={() => setOpen(true)}>
        ⓘ Methods
      </button>
      {open ? (
        <div className="mc-methods-sheet" role="dialog" aria-label="Methods and definitions">
          <div className="mc-methods-head">
            <h5>Methods &amp; definitions</h5>
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
        </div>
      ) : null}
    </div>
  );
}
