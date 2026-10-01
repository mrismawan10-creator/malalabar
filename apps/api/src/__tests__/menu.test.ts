import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MenuItemDetail, MenuResponse } from "@malalabar/types";
import { buildApp } from "../app.js";
import { discountPercent } from "../services/menu.service.js";
import { signCustomerSessionToken } from "../lib/tokens.js";
import { createFakeTableRepository } from "./fake-table-repository.js";
import { createFakeMenuRepository } from "./fake-menu-repository.js";
import {
  createFakeSessionRepository,
  createFakeSettingsRepository,
} from "./fake-session-repository.js";

let app: FastifyInstance;
let sessions: ReturnType<typeof createFakeSessionRepository>;
let settings: ReturnType<typeof createFakeSettingsRepository>;
let token: string;
let sessionId: string;

const MENU = "/api/v1/menu";

/** Authenticated as the current customer session. */
function get(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

/** No Authorization header at all — a stranger hitting the endpoint. */
function getAnon(url: string) {
  return app.inject({ method: "GET", url });
}

beforeEach(async () => {
  sessions = createFakeSessionRepository();
  settings = createFakeSettingsRepository();
  app = await buildApp({
    tableRepository: createFakeTableRepository(),
    sessionRepository: sessions,
    settingsRepository: settings,
    menuRepository: createFakeMenuRepository(),
  });
  await app.ready();

  const session = await sessions.createOpen("table-1");
  sessionId = session.id;
  token = signCustomerSessionToken({
    sessionId,
    tableId: "table-1",
    expiresInSeconds: 3600,
  });
});

afterEach(async () => {
  await app.close();
});

describe("GET /menu — access control", () => {
  it("requires a customer session token (failure path)", async () => {
    const res = await getAnon(MENU);
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token whose session has closed (failure path)", async () => {
    sessions.setStatus(sessionId, "PAID");
    const res = await get(MENU);
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "SESSION_CLOSED",
    );
  });
});

describe("GET /menu — payload", () => {
  it("returns whether the restaurant is accepting orders", async () => {
    expect((await get(MENU)).json<MenuResponse>().acceptingOrders).toBe(true);

    await settings.update({ acceptingOrders: false });
    expect((await get(MENU)).json<MenuResponse>().acceptingOrders).toBe(false);
  });

  it("returns promos, ordered categories and items (happy path)", async () => {
    const res = await get(MENU);
    expect(res.statusCode).toBe(200);

    const body = res.json<MenuResponse>();
    expect(body.categories.map((c) => c.name)).toEqual([
      "Main Course",
      "Minuman",
    ]);
    expect(body.items).toHaveLength(3);
  });

  it("keeps a sold-out item in the payload with isAvailable=false (PRD 4.2.2)", async () => {
    const body = (await get(MENU)).json<MenuResponse>();

    const sate = body.items.find((i) => i.id === "item-sate");
    expect(sate).toBeDefined();
    expect(sate!.isAvailable).toBe(false);
  });

  it("carries the promo block and its discount badge on the item", async () => {
    const body = (await get(MENU)).json<MenuResponse>();

    const nasgor = body.items.find((i) => i.id === "item-nasgor")!;
    expect(nasgor.promo).toEqual({
      promoPrice: 20000,
      label: "Promo Siang",
      discountPercent: 20,
    });
  });

  it("hides an inactive promo completely (PRD 4.2.1)", async () => {
    const body = (await get(MENU)).json<MenuResponse>();

    expect(body.items.find((i) => i.id === "item-teh")!.promo).toBeNull();
    expect(body.promos.map((p) => p.menuItemId)).not.toContain("item-teh");
  });

  it("builds the promo carousel with original and promo price", async () => {
    const body = (await get(MENU)).json<MenuResponse>();

    expect(body.promos).toEqual([
      {
        menuItemId: "item-nasgor",
        itemName: "Nasi Goreng",
        imageUrl: "https://cdn.example/nasgor.jpg",
        basePrice: 25000,
        promoPrice: 20000,
        label: "Promo Siang",
        discountPercent: 20,
      },
    ]);
  });

  it("flags which items have customizations", async () => {
    const body = (await get(MENU)).json<MenuResponse>();

    expect(body.items.find((i) => i.id === "item-nasgor")!.hasCustomizations).toBe(
      true,
    );
    expect(body.items.find((i) => i.id === "item-sate")!.hasCustomizations).toBe(
      false,
    );
  });
});

describe("GET /menu/items/:id", () => {
  it("returns customization groups with required flags (happy path)", async () => {
    const res = await get(`${MENU}/items/item-nasgor`);
    expect(res.statusCode).toBe(200);

    const body = res.json<MenuItemDetail>();
    expect(body.name).toBe("Nasi Goreng");
    expect(body.promo).toEqual({ promoPrice: 20000, label: "Promo Siang" });

    const [level, topping] = body.customizationGroups;
    expect(level).toMatchObject({
      name: "Level Pedas",
      type: "SINGLE_SELECT",
      isRequired: true,
    });
    expect(topping).toMatchObject({
      name: "Topping",
      type: "MULTI_SELECT",
      isRequired: false,
    });
    expect(topping!.options).toEqual([
      { id: "opt-egg", name: "Telur", surchargePrice: 5000, isAvailable: true },
      { id: "opt-sausage", name: "Sosis", surchargePrice: 7000, isAvailable: true },
    ]);
  });

  it("omits an inactive promo on the detail too", async () => {
    const body = (await get(`${MENU}/items/item-teh`)).json<MenuItemDetail>();
    expect(body.promo).toBeNull();
    expect(body.customizationGroups).toEqual([]);
  });

  it("returns 404 for an unknown or soft-deleted item (failure path)", async () => {
    const res = await get(`${MENU}/items/item-deleted`);
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "ITEM_NOT_FOUND",
    );
  });

  it("requires a customer session token (failure path)", async () => {
    const res = await getAnon(`${MENU}/items/item-nasgor`);
    expect(res.statusCode).toBe(401);
  });
});

describe("discountPercent", () => {
  it("rounds to a whole percent", () => {
    expect(discountPercent(25000, 20000)).toBe(20);
    expect(discountPercent(30000, 19999)).toBe(33);
  });

  it("never reports a negative or nonsensical discount", () => {
    expect(discountPercent(10000, 10000)).toBe(0);
    expect(discountPercent(10000, 12000)).toBe(0);
    expect(discountPercent(0, 0)).toBe(0);
  });
});
