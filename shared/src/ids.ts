import type { Module } from './schemas';

// Module ids look like `modulo-NN-slug` (for example `modulo-03-condicionales`).
const MODULE_ID_PATTERN = /^modulo-(\d{2})-/;

/**
 * Derives the exercise ids of a module by convention: `mNN-eMM`, where NN is
 * the two-digit module number taken from `module.id` and MM runs from 01 to
 * `module.exerciseCount`, zero-padded to two digits (the 10th exercise is
 * `e10`).
 *
 * The contract has no endpoint that lists the exercises of a module, so
 * clients use this helper instead.
 *
 * Example: `modulo-03-condicionales` with `exerciseCount` 3 returns
 * `['m03-e01', 'm03-e02', 'm03-e03']`.
 *
 * @throws {Error} If `module.id` does not match `modulo-NN-...`. Failing loudly
 * is deliberate: returning an empty list or ids with `undefined` would hide a
 * broken content folder name.
 */
export function exerciseIdsFor(module: Module): string[] {
  const moduleNumber = MODULE_ID_PATTERN.exec(module.id)?.[1];
  if (moduleNumber === undefined) {
    throw new Error(
      `Invalid module id "${module.id}": expected the format "modulo-NN-<name>" (for example "modulo-03-condicionales")`,
    );
  }
  return Array.from(
    { length: module.exerciseCount },
    (_, i) => `m${moduleNumber}-e${String(i + 1).padStart(2, '0')}`,
  );
}
