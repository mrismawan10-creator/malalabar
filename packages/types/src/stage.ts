import type { StageSemantic } from "./events.js";

/**
 * Order status stages — API_Contract §8, PRD 4.7.3, State_Machine §1.1.
 *
 * Data-driven flow: anchored semantics keep their relative order; superadmin
 * CUSTOM stages may only sit between IN_PROGRESS and READY (V1 scope), are
 * informational only, and never introduce new actors.
 */

export interface StageAdminRow {
  id: string;
  label: string;
  description: string | null;
  semanticKey: StageSemantic;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateStageRequest {
  label: string;
  description?: string;
  /** The stage the new CUSTOM stage should come after. */
  afterStageId: string;
}

export interface UpdateStageRequest {
  label?: string;
  /** null clears the description. */
  description?: string | null;
}

export interface ReorderStagesRequest {
  /** Every active stage id, in the desired order. */
  orderedIds: string[];
}

export interface SetStageActiveRequest {
  isActive: boolean;
}
