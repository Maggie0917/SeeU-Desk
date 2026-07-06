export function MetricCard({
  label,
  value,
  hint,
  tone = "white"
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "white" | "cream" | "blue" | "primary";
}) {
  const toneClass = {
    white: "bg-white",
    cream: "bg-paper",
    blue: "border-sky bg-sky text-white",
    primary: "border-leaf bg-leaf text-white"
  }[tone];
  const subtleText = tone === "white" || tone === "cream" ? "text-moss" : "text-white/80";
  const strongText = tone === "white" || tone === "cream" ? "text-ink" : "text-white";

  return (
    <div className={`card-tight ${toneClass}`}>
      <div className={`text-sm font-medium ${subtleText}`}>{label}</div>
      <div className={`mt-2 text-3xl font-black ${strongText}`}>{value}</div>
      {hint ? <div className={`mt-2 text-xs ${subtleText}`}>{hint}</div> : null}
    </div>
  );
}
