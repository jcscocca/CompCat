export type MethodDefinition = {
  id: string;
  term: string;
  shownAs: string;
  plain: string;
  howToRead: string;
  formula?: string;
};

export const METHODS_DEFINITIONS: MethodDefinition[] = [
  { id: "reportedIncidentRate", term: "Exposure-adjusted rate", shownAs: "12 /yr",
    plain: "The underlying rate is reported-event density per square kilometre per day. The display scales that density to a full year and your circle's area. With a window shorter than a year this is an extrapolation, not an observed count.",
    howToRead: "A density of reports, not a per-person or per-visit rate.", formula: "per-year = incidents ÷ days × 365.25" },
  { id: "beatBaselineRate", term: "Area baselines", shownAs: "neighborhood · beat · sector · citywide",
    plain: "Four reference levels your place is compared against: every neighborhood (MCPP) and police beat the circle touches is pooled at its level, and both levels EXCLUDE the area inside your radius so the place is not compared to itself; sector and citywide references do not exclude it because one radius is a negligible share at that scale. The same filters apply to every baseline.",
    howToRead: "Four different answers to 'normal compared to what?' — expect them to disagree." },
  { id: "rateRatio", term: "Rate ratio", shownAs: "4.0×",
    plain: "How many times the place's density sits above or below a baseline area's.",
    howToRead: "Above 1× = busier than the surrounding area; below 1× = quieter." },
  { id: "absoluteRateInterval", term: "Absolute-rate interval", shownAs: "4.2–8.1 /yr",
    plain: "The range around one place's own reported-density rate, rescaled to expected reports per year inside the selected radius. It describes that one rate; it is not the interval for a rate ratio against another place or baseline.",
    howToRead: "This is the bar around a place's dot. It is not adjusted for multiple comparisons." },
  { id: "confidenceInterval", term: "Rate-ratio interval", shownAs: "2.1–7.6×",
    plain: "The plausible range for the ratio between a place and a comparator. Absolute-rate and rate-ratio intervals both use a large-sample Wald form on the log scale, widened with Student-t because burstiness φ is estimated from a handful of months. Coverage is near, not exactly, 95%, and calibration fell to about 89% with very bursty, small counts.",
    howToRead: "Shown in analytical detail. The interval is not adjusted for multiple comparisons; the verdict uses the adjusted p-value and also requires the ratio past 1.25× / 0.8×. Wider = less certain." },
  { id: "adjustedPValue", term: "Statistically clear", shownAs: "the verdict badge",
    plain: "Whether the difference is large and reliable enough to flag after Benjamini–Hochberg adjustment within each run's comparison family. One place has up to four baselines; a run with several places gets a separate adjustment across several places, and Compare's candidate-vs-other tests form their own family. Separate runs are not adjusted together.",
    howToRead: "Clear means adjusted p < 0.05 and the ratio is past 1.25× / 0.8×." },
  { id: "overdispersion", term: "Dispersion φ / quasi-Poisson", shownAs: "φ 1.4",
    plain: "We always widen intervals by the measured burstiness (φ), never narrowing below plain Poisson; above φ 1.2 the method is labeled quasi-Poisson. Because φ is estimated from a handful of months, intervals use a Student-t multiplier.",
    howToRead: "Higher φ = burstier reports, wider intervals." },
  { id: "minimumDataStatus", term: "Data adequacy", shownAs: "insufficient data",
    plain: "We won't call a result unless the window is at least 30 days, this place has at least 3 incidents, and place and baseline together have at least 10. Results are also withheld when the baseline area is too small to compare against, when there is no area-time to compare (non-positive exposure), or when the dispersion model itself warns it had too few months to fit.",
    howToRead: "Below that, the verdict reads 'insufficient data' rather than guessing." },
  { id: "nearestIncident", term: "Nearest incident", shownAs: "42 m",
    plain: "Distance to the closest matching reported incident.",
    howToRead: "Proximity only — not severity." },
  { id: "monthlyTrend", term: "Monthly trend", shownAs: "the sparkline",
    plain: "Reported incidents per month across the selected range.",
    howToRead: "Shape over time, not a forecast." },
  { id: "radiusMatters", term: "Radius matters", shownAs: "250 m / 500 m / 1000 m",
    plain: "Every result is radius-dependent by construction: the circle defines both the incidents counted and the area they are divided by.",
    howToRead: "Try several radii. A verdict at 250 m can legitimately differ at 1000 m." },
  { id: "manyLooks", term: "Many looks", shownAs: "filters, radii, layers",
    plain: "Scanning many filter combinations will surface an occasional 'clear' result by chance; the adjustment covers the tests within one run, not the runs you tried.",
    howToRead: "Treat a lone surprise across many looks with caution." },
  { id: "compareRanking", term: "Compare order", shownAs: "1 · 2 · 3 · lowest rate",
    plain: "The numbered order and lowest-rate chip are descriptive. The lowest observed rate is selected after looking at the data, so it is biased low by ordinary sampling noise.",
    howToRead: "Only an overall statistically lower verdict is a tested conclusion; the displayed order itself is not a statistical ranking." },
  { id: "nibrsGroup", term: "NIBRS group", shownAs: "NIBRS A",
    plain: "The FBI's National Incident-Based Reporting System classification SPD files each offense under. Group A covers the offenses reported in full detail; Group B covers a shorter list reported only when an arrest is made.",
    howToRead: "A filing category, not a severity ranking." },
];
