export function chooseSupplierCandidate<
  T extends {
    priority: number;
    costPrice: number;
    successRate: number;
    stabilityScore: number;
    profit: number;
    averageDurationMs: number;
  },
>(candidates: T[]): T | null {
  return (
    [...candidates].sort(
      (left, right) =>
        right.successRate - left.successRate ||
        right.stabilityScore - left.stabilityScore ||
        left.costPrice - right.costPrice ||
        right.profit - left.profit ||
        left.priority - right.priority ||
        left.averageDurationMs - right.averageDurationMs,
    )[0] ?? null
  );
}
