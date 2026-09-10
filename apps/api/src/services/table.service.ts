import type {
  AdminTable,
  QrFormat,
  TableWithTokenResponse,
} from "@malalabar/types";
import type { RestaurantTable } from "@malalabar/db";
import { Prisma } from "@malalabar/db";
import { AppError } from "../lib/errors.js";
import {
  qrFileBaseName,
  renderQrPdf,
  renderQrPng,
} from "../lib/qr-image.js";
import { mintTableToken } from "../lib/qr-token.js";
import type { TableRepository } from "../repositories/table.repository.js";

/** All timestamps leave the API as ISO 8601 UTC (CLAUDE.md hard rule 10). */
function toDto(row: RestaurantTable): AdminTable {
  return {
    id: row.id,
    number: row.number,
    area: row.area,
    isActive: row.isActive,
    tokenVersion: row.tokenVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** "" and whitespace-only mean "no area", stored as NULL. */
function normalizeArea(area: string | null | undefined): string | null {
  if (area === undefined || area === null) return null;
  const trimmed = area.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

const takenError = (number: string, area: string | null) =>
  new AppError(
    "TABLE_NUMBER_TAKEN",
    area
      ? `Table ${number} already exists in area ${area}`
      : `Table ${number} already exists`,
    409,
  );

export interface TableService {
  list(params: { page: number; pageSize: number }): Promise<{
    data: AdminTable[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  create(input: {
    number: string;
    area?: string | null;
  }): Promise<TableWithTokenResponse>;
  update(
    id: string,
    patch: { number?: string; area?: string | null; isActive?: boolean },
  ): Promise<AdminTable>;
  regenerateQr(id: string): Promise<TableWithTokenResponse>;
  getQrArtifact(id: string, format: QrFormat): Promise<QrArtifact>;
}

export interface QrArtifact {
  body: Buffer;
  contentType: string;
  filename: string;
}

export function createTableService(repo: TableRepository): TableService {
  async function getOr404(id: string): Promise<RestaurantTable> {
    const row = await repo.findById(id);
    if (!row) throw new AppError("TABLE_NOT_FOUND", "Table not found", 404);
    return row;
  }

  return {
    async list({ page, pageSize }) {
      const { rows, total } = await repo.list({ page, pageSize });
      return { data: rows.map(toDto), page, pageSize, total };
    },

    async create(input) {
      const number = input.number.trim();
      const area = normalizeArea(input.area);

      // Checked here because @@unique([number, area]) does not bind when area
      // is NULL — Postgres treats each NULL as distinct. See the note in
      // table.repository.ts. The catch below is the race backstop.
      if (await repo.findByNumberAndArea(number, area)) {
        throw takenError(number, area);
      }

      try {
        const row = await repo.create({
          number,
          area,
          qrToken: mintTableToken(),
        });
        return { table: toDto(row), qrToken: row.qrToken };
      } catch (err) {
        if (isUniqueViolation(err)) throw takenError(number, area);
        throw err;
      }
    },

    async update(id, patch) {
      const current = await getOr404(id);

      const number = patch.number?.trim() ?? current.number;
      const area =
        patch.area === undefined ? current.area : normalizeArea(patch.area);

      const identityChanged =
        number !== current.number || area !== current.area;

      if (identityChanged) {
        const clash = await repo.findByNumberAndArea(number, area);
        if (clash && clash.id !== id) throw takenError(number, area);
      }

      try {
        const row = await repo.update(id, {
          ...(patch.number !== undefined ? { number } : {}),
          ...(patch.area !== undefined ? { area } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        });
        return toDto(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw takenError(number, area);
        throw err;
      }
    },

    async regenerateQr(id) {
      await getOr404(id);
      // Rotation IS revocation: the old value stops resolving the moment this
      // write lands (CLAUDE.md hard rule 6). Open sessions are unaffected —
      // they already hold a session token (Auth_RBAC_Spec §3.1).
      const row = await repo.rotateToken(id, mintTableToken());
      return { table: toDto(row), qrToken: row.qrToken };
    },

    async getQrArtifact(id, format) {
      const row = await getOr404(id);
      const base = qrFileBaseName(row.number, row.area);

      // A deactivated table still yields a downloadable QR: deactivation blocks
      // the customer at POST /sessions (PRD 4.1.1), not the admin's printing.
      if (format === "pdf") {
        return {
          body: await renderQrPdf({
            qrToken: row.qrToken,
            number: row.number,
            area: row.area,
          }),
          contentType: "application/pdf",
          filename: `${base}.pdf`,
        };
      }

      return {
        body: await renderQrPng(row.qrToken),
        contentType: "image/png",
        filename: `${base}.png`,
      };
    },
  };
}
