import { BarChart3 } from "lucide-react";
import { FormEvent, useState } from "react";

type AnalyzeRequest = {
  analysis_start_date: string;
  analysis_end_date: string;
  radii_m: number[];
  offense_category: string | null;
};

type CompareRequest = {
  analysis_start_date: string;
  analysis_end_date: string;
  radius_m: number;
  offense_category: string | null;
};

type Props = {
  selectedCount: number;
  onAnalyze: (request: AnalyzeRequest) => Promise<void>;
  onCompare: (request: CompareRequest) => Promise<void>;
};

export function AnalysisControls({
  selectedCount,
  onAnalyze,
  onCompare,
}: Props) {
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-01-31");
  const [radius, setRadius] = useState("250");
  const [offenseCategory, setOffenseCategory] = useState("PROPERTY");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isComparing, setIsComparing] = useState(false);

  const requestBase = {
    analysis_start_date: startDate,
    analysis_end_date: endDate,
    offense_category: offenseCategory || null,
  };

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedCount < 1 || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    try {
      await onAnalyze({
        ...requestBase,
        radii_m: [Number(radius)],
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCompare() {
    if (selectedCount < 2 || isComparing) {
      return;
    }

    setIsComparing(true);
    try {
      await onCompare({
        ...requestBase,
        radius_m: Number(radius),
      });
    } finally {
      setIsComparing(false);
    }
  }

  return (
    <section className="panel controls" aria-labelledby="analysis-controls-title">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Analysis</p>
          <h2 id="analysis-controls-title">Analysis controls</h2>
        </div>
        <span className="count-pill">{selectedCount} selected</span>
      </div>

      <form onSubmit={handleAnalyze}>
        <div className="form-grid controls-grid">
          <div>
            <label htmlFor="analysis-start-date">Start date</label>
            <input
              id="analysis-start-date"
              name="analysis-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="analysis-end-date">End date</label>
            <input
              id="analysis-end-date"
              name="analysis-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="analysis-radius">Radius</label>
            <select
              id="analysis-radius"
              name="analysis-radius"
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
            >
              <option value="250">250 m</option>
              <option value="500">500 m</option>
              <option value="1000">1000 m</option>
            </select>
          </div>
          <div>
            <label htmlFor="offense-category">Category</label>
            <select
              id="offense-category"
              name="offense-category"
              value={offenseCategory}
              onChange={(event) => setOffenseCategory(event.target.value)}
            >
              <option value="">All categories</option>
              <option value="PROPERTY">Property</option>
              <option value="PERSON">Person</option>
              <option value="SOCIETY">Society</option>
            </select>
          </div>
        </div>

        <div className="button-row">
          <button type="submit" disabled={selectedCount < 1 || isAnalyzing}>
            <BarChart3 size={18} aria-hidden="true" />
            {isAnalyzing ? "Running..." : "Run analysis"}
          </button>
          <button
            type="button"
            disabled={selectedCount < 2 || isComparing}
            onClick={handleCompare}
          >
            {isComparing ? "Comparing..." : "Compare places"}
          </button>
        </div>
      </form>
    </section>
  );
}
