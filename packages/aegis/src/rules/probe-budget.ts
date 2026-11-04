/** VM timeouts are positive integer wall-clock milliseconds; invalid values retain the guard. */
export function redosProbeBudgetMs(value: string | undefined): number {
  const configured = Number(value ?? '25');
  return Number.isFinite(configured) && configured > 0 && configured <= 2_147_483_647
    ? Math.ceil(configured) : 25;
}
