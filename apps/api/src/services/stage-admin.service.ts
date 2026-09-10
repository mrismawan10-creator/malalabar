import type { Prisma } from "@malalabar/db";
import type { StageSemantic } from "@malalabar/types";
import type { StageAdminRow } from "@malalabar/types";
import { AppError } from "../lib/errors.js";
import type { StageRepository } from "../repositories/stage.repository.js";

/**
 * Superadmin order-status stage management — API_Contract §8, PRD 4.7.3,
 * State_Machine §1.1.
 *
 * Anchored semantics (AWAITING_CONFIRMATION → ACCEPTED → IN_PROGRESS → READY
 * → SERVED) keep their relative order and can never be deactivated — code
 * keys transitions off them. CUSTOM stages are informational and may only
 * live between IN_PROGRESS and READY (V1 scope). Deactivation is soft; rows
 * are never deleted (history integrity, Data_Model §3.4).
 */

export interface StageAdminService {
  list(): Promise<StageAdminRow[]>;
  create(
    input: { label: string; description?: string; afterStageId: string },
    actor: { staffId: string; ipAddress?: string },
  ): Promise<StageAdminRow>;
  update(
    id: string,
    body: { label?: string; description?: string | null },
    actor: { staffId: string; ipAddress?: string },
  ): Promise<StageAdminRow>;
  reorder(
    orderedIds: string[],
    actor: { staffId: string; ipAddress?: string },
  ): Promise<void>;
  setActive(
    id: string,
    isActive: boolean,
    actor: { staffId: string; ipAddress?: string },
  ): Promise<StageAdminRow>;
}

/** Anchored semantics in their mandatory relative order. */
export const ANCHOR_ORDER: StageSemantic[] = [
  "AWAITING_CONFIRMATION",
  "ACCEPTED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
];

/** CUSTOM stages may only be anchored to these (State_Machine §1.1). */
const CUSTOM_AFTER_SEMANTICS: StageSemantic[] = ["IN_PROGRESS", "CUSTOM"];

export function createStageAdminService(deps: {
  repo: StageRepository;
}): StageAdminService {
  const { repo } = deps;

  async function audit(
    actor: { staffId: string; ipAddress?: string },
    action: string,
    entityId: string,
    metadata: unknown = {},
  ) {
    await repo.writeAudit({
      actorId: actor.staffId,
      action,
      entityType: "ORDER_STATUS_STAGE",
      entityId,
      // Round-trip so undefined optionals never leak into the Json column.
      metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonObject,
      ipAddress: actor.ipAddress,
    });
  }

  return {
    async list() {
      return repo.listAll();
    },

    async create(input, actor) {
      const after = await repo.findById(input.afterStageId);
      if (!after) {
        throw new AppError("STAGE_NOT_FOUND", "Stage acuan tidak ditemukan", 404);
      }
      if (!after.isActive) {
        throw new AppError(
          "INVALID_STAGE_POSITION",
          "Stage acuan sudah dinonaktifkan",
          422,
        );
      }
      if (!CUSTOM_AFTER_SEMANTICS.includes(after.semanticKey)) {
        throw new AppError(
          "INVALID_STAGE_POSITION",
          "Stage custom hanya boleh disisipkan antara 'Diproses' dan 'Siap'",
          422,
        );
      }

      const created = await repo.createCustom({
        label: input.label,
        description: input.description ?? null,
        afterSortOrder: after.sortOrder,
      });

      await audit(actor, "CREATE_STAGE", created.id, {
        label: created.label,
        afterStageId: after.id,
      });

      return created;
    },

    async update(id, body, actor) {
      const target = await repo.findById(id);
      if (!target) {
        throw new AppError("STAGE_NOT_FOUND", "Stage tidak ditemukan", 404);
      }

      const updated = await repo.update(id, body);
      await audit(actor, "UPDATE_STAGE", id, { changes: { ...body } });
      return updated;
    },

    async reorder(orderedIds, actor) {
      const active = await repo.listActive();
      const activeIds = new Set(active.map((stage) => stage.id));

      if (
        orderedIds.length !== activeIds.size ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !activeIds.has(id))
      ) {
        throw new AppError(
          "INVALID_STAGE_ORDER",
          "Daftar harus memuat semua stage aktif, masing-masing tepat satu kali",
          422,
        );
      }

      const semanticById = new Map(
        active.map((stage) => [stage.id, stage.semanticKey]),
      );
      const positionOf = (id: string) => orderedIds.indexOf(id);

      // Anchored semantics must keep their relative order.
      for (let i = 1; i < ANCHOR_ORDER.length; i += 1) {
        const earlier = active.find(
          (stage) => stage.semanticKey === ANCHOR_ORDER[i - 1],
        );
        const later = active.find(
          (stage) => stage.semanticKey === ANCHOR_ORDER[i],
        );
        if (earlier && later && positionOf(earlier.id) >= positionOf(later.id)) {
          throw new AppError(
            "ANCHOR_ORDER_VIOLATED",
            "Urutan stage inti tidak boleh diubah",
            422,
          );
        }
      }

      // CUSTOM stages only between IN_PROGRESS and READY (V1 scope).
      const inProgress = active.find(
        (stage) => stage.semanticKey === "IN_PROGRESS",
      );
      const ready = active.find((stage) => stage.semanticKey === "READY");
      for (const id of orderedIds) {
        const semantic = semanticById.get(id);
        if (
          semantic === "CUSTOM" &&
          inProgress &&
          ready &&
          !(positionOf(id) > positionOf(inProgress.id) && positionOf(id) < positionOf(ready.id))
        ) {
          throw new AppError(
            "INVALID_STAGE_ORDER",
            "Stage custom hanya boleh berada di antara 'Diproses' dan 'Siap'",
            422,
          );
        }
      }

      await repo.reorder(orderedIds);
      await audit(actor, "REORDER_STAGES", "all", { orderedIds });
    },

    async setActive(id, isActive, actor) {
      const target = await repo.findById(id);
      if (!target) {
        throw new AppError("STAGE_NOT_FOUND", "Stage tidak ditemukan", 404);
      }
      if (!isActive && target.semanticKey !== "CUSTOM") {
        throw new AppError(
          "ANCHORED_STAGE_PROTECTED",
          "Stage inti tidak bisa dinonaktifkan — alur dapur bergantung padanya",
          422,
        );
      }

      const updated = await repo.setActive(id, isActive);
      await audit(actor, isActive ? "REACTIVATE_STAGE" : "DEACTIVATE_STAGE", id, {
        label: updated.label,
      });
      return updated;
    },
  };
}
