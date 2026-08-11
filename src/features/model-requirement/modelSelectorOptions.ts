import type { ModelRecord } from "../../types";

type ModelSelectorRecord = Pick<
  ModelRecord,
  "id" | "name" | "provider" | "family" | "totalParametersB"
>;

function alphabeticalKey(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function compareAlphabetically(left: string, right: string): number {
  const leftKey = alphabeticalKey(left);
  const rightKey = alphabeticalKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

/**
 * Returns the label used to keep related model variants together. Older or
 * browser-authored records may omit `family`, so their name and provider form
 * a deterministic fallback instead of creating an unsorted bucket.
 */
export function modelSelectorFamily(model: ModelSelectorRecord): string {
  return (
    model.family?.trim() ||
    model.name.trim() ||
    model.provider.trim() ||
    model.id
  );
}

/**
 * Sorts one selector source group without mutating its catalog array.
 * Family ordering is locale-independent and case-insensitive. Variants in the
 * same family use total parameter count, then name and stable ID.
 */
export function sortModelsForSelector<Model extends ModelSelectorRecord>(
  models: readonly Model[],
): Model[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((left, right) => {
      const familyOrder = compareAlphabetically(
        modelSelectorFamily(left.model),
        modelSelectorFamily(right.model),
      );
      if (familyOrder !== 0) return familyOrder;

      const parameterOrder =
        left.model.totalParametersB - right.model.totalParametersB;
      if (parameterOrder !== 0) return parameterOrder;

      const nameOrder = compareAlphabetically(
        left.model.name,
        right.model.name,
      );
      if (nameOrder !== 0) return nameOrder;

      const idOrder = compareAlphabetically(left.model.id, right.model.id);
      if (idOrder !== 0) return idOrder;

      return left.index - right.index;
    })
    .map(({ model }) => model);
}

/** Keeps the visible family first while avoiding a repeated name for legacy records. */
export function modelSelectorOptionLabel(
  model: ModelSelectorRecord,
  parameterSizeLabel: string,
): string {
  const family = modelSelectorFamily(model);
  const name = model.name.trim() || family;
  const provider = model.provider.trim();
  const providerSuffix = provider ? ` (${provider})` : "";

  if (alphabeticalKey(family) === alphabeticalKey(name)) {
    return `${name} / ${parameterSizeLabel}${providerSuffix}`;
  }

  return `${family} / ${parameterSizeLabel} / ${name}${providerSuffix}`;
}
