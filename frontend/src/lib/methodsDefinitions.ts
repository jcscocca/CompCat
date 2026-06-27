export type MethodDefinition = {
  id: string;
  term: string;
  shownAs: string;
  plain: string;
  howToRead: string;
  formula?: string;
};

export const METHODS_DEFINITIONS: MethodDefinition[] = [
  { id: "reportedIncidentRate", term: "Exposure-adjusted rate", shownAs: "0.67 /km²·day",
    plain: "Incidents per square kilometer per day — counts divided by how much area and time you're viewing, so places of different sizes compare fairly.",
    howToRead: "A density of reports, not your personal odds.", formula: "rate = incidents ÷ (area_km² × days)" },
  { id: "beatBaselineRate", term: "Surrounding-beat baseline", shownAs: "Beat M2",
    plain: "The rest of your place's SPD police beat (2018-present), EXCLUDING the area inside your search radius, used as the 'normal for this area' reference. The same filters apply.",
    howToRead: "Your place is compared to its surroundings, not to itself." },
  { id: "rateRatio", term: "Rate ratio", shownAs: "4.0×",
    plain: "How many times the place's density sits above or below the rest of its beat.",
    howToRead: "Above 1× = busier than the surrounding beat; below 1× = quieter." },
  { id: "confidenceInterval", term: "95% confidence interval", shownAs: "2.1–7.6×",
    plain: "The plausible range for the ratio given the sample size, for this single place-vs-beat comparison.",
    howToRead: "Shown in the analytical detail. The verdict also adjusts for comparing several places and requires the ratio past 1.25× / 0.8×, so a CI that just clears 1× may still read 'not clear.' Wider = less certain." },
  { id: "adjustedPValue", term: "Statistically clear", shownAs: "the verdict badge",
    plain: "Whether the difference is large and reliable enough to flag, after adjusting for testing several places at once (Benjamini–Hochberg).",
    howToRead: "Clear means adjusted p < 0.05 and the ratio is past 1.25× / 0.8×." },
  { id: "overdispersion", term: "Dispersion φ / quasi-Poisson", shownAs: "φ 1.4",
    plain: "Whether incidents cluster in time more than chance. If they do (φ > 1.2), we widen the math (quasi-Poisson).",
    howToRead: "Higher φ = burstier reports, wider intervals." },
  { id: "minimumDataStatus", term: "Data adequacy", shownAs: "insufficient data",
    plain: "We won't call a result unless there are at least 30 days and 10 combined incidents.",
    howToRead: "Below that, the verdict reads 'insufficient data' rather than guessing." },
  { id: "nearestIncident", term: "Nearest incident", shownAs: "42 m",
    plain: "Distance to the closest matching reported incident.",
    howToRead: "Proximity only — not severity." },
  { id: "monthlyTrend", term: "Monthly trend", shownAs: "the sparkline",
    plain: "Reported incidents per month across the selected range.",
    howToRead: "Shape over time, not a forecast." },
  { id: "exactPValue", term: "Exact p-value", shownAs: "0.012",
    plain: "A small-sample exact conditional Poisson p-value, shown for transparency. The verdict is decided on the interval-consistent (Wald) p-value instead.",
    howToRead: "Supplementary — the badge does not depend on it." },
];
