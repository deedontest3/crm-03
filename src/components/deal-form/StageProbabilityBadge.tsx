import { STAGE_PROBABILITY, type DealStage } from "@/types/deal";

interface StageProbabilityBadgeProps {
  stage: DealStage;
}

export const StageProbabilityBadge = ({ stage }: StageProbabilityBadgeProps) => {
  const probability = STAGE_PROBABILITY[stage];
  if (probability === undefined) return null;

  const fillColor = `hsl(142, ${70 + (probability / 100) * 20}%, ${90 - (probability / 100) * 45}%)`;

  return (
    <div
      className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary shadow-sm"
      title="Probability is auto-calculated from the stage"
      aria-label={`Probability ${probability} percent`}
    >
      <div
        className="absolute left-0 top-0 h-full transition-all duration-500 ease-out"
        style={{ width: `${probability}%`, backgroundColor: fillColor }}
        aria-hidden="true"
      />
      <span className="relative z-10 h-2 w-2 rounded-full bg-primary" />
      <span className="relative z-10">Probability · {probability}%</span>
    </div>
  );
};
