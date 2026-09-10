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
            { id: "opt-mild", name: "Tidak Pedas", surchargePrice: 0, isAvailable: true },
            { id: "opt-hot", name: "Pedas", surchargePrice: 0, isAvailable: true },
          ],
        },
        {
          id: "grp-add",
          name: "Tambahan",
          type: "MULTI_SELECT",
          isRequired: false,
          options: [
            { id: "opt-egg", name: "Tambah Telur", surchargePrice: 3000, isAvailable: true },
            { id: "opt-chicken", name: "Tambah Ayam", surchargePrice: 8000, isAvailable: true },
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
  /** Marks a stored batch cancelled, as the superadmin override would (T7.4). */
  cancel(batchNumber: number, reason: string): void;
  history(): Array<{ orderId: string; stageId: string; actorType: string }>;
  sessionTouched(): string[];
  /** Runs before each persist — used to simulate a batch-number race. */
  onBeforePersist?: (input: PersistOrderInput) => void;
  /** Test hook: plant the session's payment row, as payment initiation would. */
  setSessionPayment(
    payment: { id: string; method: "CASH" | "CARD" | "ONLINE"; status: string; totalAmount: number } | null,
  ): void;
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
  let sessionPayment: {
    id: string;
    method: "CASH" | "CARD" | "ONLINE";
    status: string;
    totalAmount: number;
  } | null = null;

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

    /** Test hook: mark a stored batch cancelled, as the override would (T7.4). */
    cancel(batchNumber: number, reason: string) {
      const row = persisted.find((r) => r.batchNumber === batchNumber);
      if (!row) throw new Error(`no such batch ${batchNumber}`);
      row.cancelled = true;
      row.cancelledReason = reason;
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
        cancelled: false,
        cancelledReason: null,
        rejectReason: null,
        currentStage: stage ?? AWAITING,
      });

      return row;
    },

    async findPendingOrders() {
      return persisted
        .filter(
          (o) =>
            !o.rejected && o.currentStage.semanticKey === "AWAITING_CONFIRMATION",
        )
        .map((o) => ({
          id: o.id,
          tableNumber: "1",
          batchNumber: o.batchNumber,
          itemCount: o.items.length,
          estimatedTotal: o.items.reduce((sum, item) => sum + item.lineTotal, 0),
          createdAt: o.createdAt.toISOString(),
        }));
    },

    async findOrderById(orderId: string) {
      const order = persisted.find((o) => o.id === orderId);
      if (!order) return null;
      return {
        id: order.id,
        tableNumber: "1",
        batchNumber: order.batchNumber,
        items: order.items,
        estimatedTotal: order.items.reduce((sum, item) => sum + item.lineTotal, 0),
        createdAt: order.createdAt.toISOString(),
      };
    },

    async approveOrder(
      orderId: string,
      approvedById: string,
      acceptedStageId: string,
    ) {
      const order = persisted.find((o) => o.id === orderId);
      if (!order)
        throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
      if (order.currentStage.semanticKey !== "AWAITING_CONFIRMATION")
        throw new Error("ORDER_NOT_PENDING");

      const acceptedStage: StageRow = {
        id: acceptedStageId,
        label: "Diterima",
        semanticKey: "ACCEPTED",
        sortOrder: 2,
      };
      order.currentStage = acceptedStage;

      history.push({
        orderId,
        stageId: acceptedStageId,
        actorType: "STAFF",
      });

      return { id: orderId, currentStage: acceptedStage };
    },

    async rejectOrder(orderId: string, reason: string) {
      const order = persisted.find((o) => o.id === orderId);
      if (!order) throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
      order.rejected = true;
      order.rejectReason = reason;
      return { id: orderId, rejected: true, rejectReason: reason };
    },

    async findActiveTables() {
      const tableMap = new Map<string, typeof persisted[0][]>();
      persisted.forEach((o) => {
        const key = o.sessionId;
        if (!tableMap.has(key)) tableMap.set(key, []);
        tableMap.get(key)!.push(o);
      });

      return Array.from(tableMap.entries()).map(([sessionId, orders]) => {
        const active = orders.filter((o) => !o.rejected);
        const readyOrders = active
          .filter((o) => o.currentStage.semanticKey === "READY")
          .map((o) => ({ id: o.id, batchNumber: o.batchNumber }));
        const total = active.reduce(
          (sum, o) => sum + o.items.reduce((s, i) => s + i.lineTotal, 0),
          0,
        );
        return {
          sessionId,
          tableNumber: "1",
          orderCount: active.length,
          readyCount: readyOrders.length,
          unpaidTotal: total,
          paid: false,
          readyOrders,
          pendingPayment: null,
        };
      });
    },

    setSessionPayment(payment: typeof sessionPayment) {
      sessionPayment = payment;
    },

    async findSessionPayment(_sessionId: string) {
      return sessionPayment;
    },

    async serveOrder(orderId: string, _staffId: string, servedStageId: string) {
      const order = persisted.find((o) => o.id === orderId);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.currentStage.semanticKey !== "READY") {
        throw new Error("ORDER_NOT_READY");
      }
      const servedStage: StageRow = {
        id: servedStageId,
        label: "Disajikan",
        semanticKey: "SERVED",
        sortOrder: 5,
      };
      order.currentStage = servedStage;
      history.push({ orderId, stageId: servedStageId, actorType: "STAFF" });
      return { id: orderId, currentStage: servedStage };
    },

    async findKdsOrders() {
      const inProgress = persisted.filter(
        (o) =>
          !o.rejected &&
          (o.currentStage.semanticKey === "ACCEPTED" ||
            o.currentStage.semanticKey === "IN_PROGRESS" ||
            o.currentStage.semanticKey === "CUSTOM"),
      );

      return inProgress.map((o) => ({
        id: o.id,
        tableNumber: "1",
        batchNumber: o.batchNumber,
        acceptedAt: o.createdAt.toISOString(),
        currentStage: o.currentStage,
        items: o.items,
      }));
    },

    async findAllActiveStages() {
      // Return the standard stages (test typically uses just AWAITING)
      return stage ? [stage] : [];
    },

    async advanceOrder(orderId: string, kitchenDeviceId: string) {
      const order = persisted.find((o) => o.id === orderId);
      if (!order) throw new Error("ORDER_NOT_FOUND");

      const current = order.currentStage;
      if (current.semanticKey === "AWAITING_CONFIRMATION") {
        throw new Error("ORDER_NOT_ADVANCEABLE");
      }
      if (current.semanticKey === "READY") {
        throw new Error("ORDER_ALREADY_READY");
      }

      // Advance from ACCEPTED to IN_PROGRESS, or to READY
      const nextStage: StageRow =
        current.semanticKey === "ACCEPTED"
          ? {
              id: "stage-in-progress",
              label: "Dimasak",
              semanticKey: "IN_PROGRESS",
              sortOrder: 3,
            }
          : {
              id: "stage-ready",
              label: "Siap",
              semanticKey: "READY",
              sortOrder: 4,
            };

      order.currentStage = nextStage;
      history.push({ orderId, stageId: nextStage.id, actorType: "KDS" });

      return { id: orderId, currentStage: nextStage };
    },
  };

  return repo;
}
