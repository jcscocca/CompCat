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
    plain: "Expected reported incidents per year inside your radius — observed density scaled to a full year and your circle's area. With a window shorter than a year this is an extrapolation, not an observed count.",
    howToRead: "A density of reports, not your personal odds.", formula: "per-year = incidents ÷ days × 365.25" },
  { id: "beatBaselineRate", term: "Area baselines", shownAs: "neighborhood · beat · sector · citywide",
    plain: "Four references your place is compared against: its neighborhood (MCPP) and its police beat, both of which EXCLUDE the area inside your radius so the place is not compared to itself; plus its sector and the city as a whole, which do not exclude it — at that scale one radius is a negligible share. The same filters apply to every baseline.",
    howToRead: "Four different answers to 'normal compared to what?' — expect them to disagree." },
  { id: "rateRatio", term: "Rate ratio", shownAs: "4.0×",
    plain: "How many times the place's density sits above or below a baseline area's.",
    howToRead: "Above 1× = busier than the surrounding area; below 1× = quieter." },
  { id: "confidenceInterval", term: "Approximate 95% interval", shownAs: "2.1–7.6×",
    plain: "The plausible range for the ratio given the sample size, for this single place-vs-baseline comparison. Approximate: it comes from a large-sample normal approximation, so its real coverage is near, not exactly, 95%.",
    howToRead: "Shown in the analytical detail. The verdict also adjusts for comparing several places and requires the ratio past 1.25× / 0.8×, so an interval that just clears 1× may still read 'not clear.' Wider = less certain." },
  { id: "adjustedPValue", term: "Statistically clear", shownAs: "the verdict badge",
    plain: "Whether the difference is large and reliable enough to flag, after a Benjamini–Hochberg adjustment across one place's four baselines. Comparing several addresses to each other triggers a second, separate adjustment over that set — the two are not pooled.",
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
  { id: "nibrsGroup", term: "NIBRS group", shownAs: "NIBRS A",
    plain: "The FBI's National Incident-Based Reporting System classification SPD files each offense under. Group A covers the offenses reported in full detail; Group B covers a shorter list reported only when an arrest is made.",
    howToRead: "A filing category, not a severity ranking." },
];
