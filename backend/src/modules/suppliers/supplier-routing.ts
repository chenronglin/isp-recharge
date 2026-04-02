export function chooseSupplierCandidate<T extends { priority: number; costPrice: number }>(
  candidates: T[],
): T | null {
  return (
    [...candidates].sort(
      (left, right) => left.priority - right.priority || left.costPrice - right.costPrice,
    )[0] ?? null
  );
}
