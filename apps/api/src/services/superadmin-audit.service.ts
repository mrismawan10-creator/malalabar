import type { AuditLogResponse } from "@malalabar/types";
import { resolveDateBounds } from "../lib/date-range.js";
import type { StaffRepository } from "../repositories/staff.repository.js";

/**
 * Global audit-log viewer — API_Contract §8, PRD 4.7.4.
 *
 * Every staff state-changing action across roles lands here (hard rule 9):
 * orders, payments, menu, tables, settings, stages, overrides — each row
 * carries actor, action, entity, timestamp and IP.
 */

export interface AuditLogQueryInput {
  page: number;
  pageSize: number;
  /** `YYYY-MM-DD` WIB bounds, `to` inclusive. */
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
}

export interface SuperadminAuditService {
  list(input: AuditLogQueryInput): Promise<AuditLogResponse>;
}

export function createSuperadminAuditService(deps: {
  repo: StaffRepository;
}): SuperadminAuditService {
  return {
    async list(input) {
      const bounds = resolveDateBounds(input.from, input.to);
      const { rows, total } = await deps.repo.listAuditLog({
        page: input.page,
        pageSize: input.pageSize,
        from: bounds.from,
        to: bounds.to,
        actorId: input.actorId,
        action: input.action,
      });
      return { data: rows, page: input.page, pageSize: input.pageSize, total };
    },
  };
}
