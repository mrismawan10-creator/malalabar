import type { StageSemantic } from "@malalabar/db";
import type {
  OrderMenuItemRow,
  OrderRepository,
  PersistedOrderRow,
  PersistOrderInput,
  SessionOrderRow,
  StageRow,
} from "../repositories/order.repository.js";

/**
 * Menu fixtures shaped for pricing:
 *  - nasgor: 35.000, active promo at 30.000, one REQUIRED single-select and one
 *    optional multi-select with surcharges
 *  - teh: 8.000 with an INACTIVE promo — must price at base, not 6.000
 *  - sate: sold out
 *  - tempe: plain, no options
 */
export function fakeOrderMenu(): OrderMenuItemRow[] {
  return [
    {
      id: "item-nasgor",
      name: "Nasi Goreng Spesial",
      basePrice: 35000,
      isAvailable: true,
      promo: { promoPrice: 30000, isActive: true },
      customizationGroups: [
        {
          id: "grp-level",
          name: "Level Kepedasan",
          type: "SINGLE_SELECT",
          isRequired: true,
          options: [
            { id: "opt-mild", name: "Tidak Pedas", surchargePrice: 0 },
            { id: "opt-hot", name: "Pedas", surchargePrice: 0 },
          ],
        },
        {
          id: "grp-add",
          name: "Tambahan",
          type: "MULTI_SELECT",
          isRequired: false,
          options: [
            { id: "opt-egg", name: "Tambah Telur", surchargePrice: 3000 },
            { id: "opt-chicken", name: "Tambah Ayam", surchargePrice: 8000 },
          ],
        },
      ],
    },
    {
      id: "item-teh",
      name: "Es Teh Manis",
      basePrice: 8000,
      isAvailable: true,
      promo: { promoPrice: 6000, isActive: false },
      customizationGroups: [],
    },
    {
      id: "item-sate",
      name: "Sate Ayam",
      basePrice: 30000,
      isAvailable: false,
      promo: null,
      customizationGroups: [],
    },
    {
      id: "item-tempe",
      name: "Tempe Goreng",
      basePrice: 12000,
      isAvailable: true,
      promo: null,
      customizationGroups: [],
    },
  ];
}

const AWAITING: StageRow = {
  id: "stage-awaiting",
  label: "Menunggu Konfirmasi",
  semanticKey: "AWAITING_CONFIRMATION",
  sortOrder: 1,
};

/** What the repository actually wrote, with the batch number it assigned. */
export type SavedOrder = PersistOrderInput & { batchNumber: number };

export function createFakeOrderRepository(options: {
  menu?: OrderMenuItemRow[];
  stage?: StageRow | null;
} = {}): OrderRepository & {
  saved(): SavedOrder[];
  /** Marks a stored batch rejected, as the cashier would (T3.3). */
  reject(batchNumber: number, reason: string): void;
  history(): Array<{ orderId: string; stageId: string; actorType: string }>;
  sessionTouched(): string[];
  /** Runs before each persist — used to simulate a batch-number race. */
  onBeforePersist?: (input: PersistOrderInput) => void;
} {
  const menu = options.menu ?? fakeOrderMenu();
  const stage = options.stage === undefined ? AWAITING : options.stage;

  const saved: SavedOrder[] = [];
  const history: Array<{
    orderId: string;
    stageId: string;
    actorType: string;
  }> = [];
  const touched: string[] = [];
  const batchesBySession = new Map<string, number[]>();
  const persisted: Array<SessionOrderRow & { sessionId: string }> = [];

  const repo = {
    saved: () => [...saved],
    history: () => [...history],
    sessionTouched: () => [...touched],
    onBeforePersist: undefined as
      | ((input: PersistOrderInput) => void)
      | undefined,

    async findMenuItemsForOrder(ids: string[]) {
      return menu.filter((m) => ids.includes(m.id));
    },

    async findActiveStageBySemantic(semantic: StageSemantic) {
      return stage && stage.semanticKey === semantic ? stage : null;
    },

    async listBySession(sessionId: string): Promise<SessionOrderRow[]> {
      return persisted
        .filter((row) => row.sessionId === sessionId)
        .sort((a, b) => a.batchNumber - b.batchNumber)
        .map(({ sessionId: _sessionId, ...row }) => row);
    },

    /** Test hook: mark a stored batch rejected, as the cashier would (T3.3). */
    reject(batchNumber: number, reason: string) {
      const row = persisted.find((r) => r.batchNumber === batchNumber);
      if (!row) throw new Error(`no such batch ${batchNumber}`);
      row.rejected = true;
      row.rejectReason = reason;
    },

    async persistOrder(input: PersistOrderInput): Promise<PersistedOrderRow> {
      repo.onBeforePersist?.(input);

      // The real repository assigns the batch number under a session row lock,
      // so it is decided at write time and cannot be stale. Nothing awaits
      // between reading and taking it here, which is this fake's equivalent of
      // that serialisation.
      const mine = batchesBySession.get(input.sessionId) ?? [];
      const batchNumber = mine.length === 0 ? 1 : Math.max(...mine) + 1;
      mine.push(batchNumber);
      batchesBySession.set(input.sessionId, mine);

      saved.push({ ...input, batchNumber });

      const id = `order-${saved.length}`;
      history.push({
        orderId: id,
        stageId: input.stageId,
        actorType: "CUSTOMER",
      });
      touched.push(input.sessionId);

      const row = {
        id,
        batchNumber,
        createdAt: new Date(),
        items: input.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          unitBasePrice: item.unitBasePrice,
          unitPromoPrice: item.unitPromoPrice,
          quantity: item.quantity,
          note: item.note,
          lineTotal: item.lineTotal,
          customizations: item.customizations,
        })),
      };

      persisted.push({
        ...row,
        sessionId: input.sessionId,
        rejected: false,
        rejectReason: null,
        currentStage: stage ?? AWAITING,
      });

      return row;
    },
  };

  return repo;
}
