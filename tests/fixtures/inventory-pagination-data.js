import { randomUUID } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { ids, requireAcademicIsolation } from "./academic-data.js";

export async function seedInventoryPagination() {
  requireAcademicIsolation();
  const tag = randomUUID().slice(0, 8);
  const [main, other, privateBranch] = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    code: "PAG-" + tag + "-" + index,
    name: "Sucursal paginación " + tag + " " + (index + 1),
    information_source: "Fixture sintético",
  }));
  const product = (suffix, name) => ({
    id: randomUUID(),
    sku: suffix + "-" + tag.toUpperCase(),
    name,
    category: "FRAME",
    inventory_mode: "TRACKED",
    is_test_data: true,
    unit_price_cents: 1000,
    created_by: ids.admin,
    updated_by: ids.admin,
  });
  const others = Array.from({ length: 34 }, (_, index) => product("AAA-" + index, "Paginación marco " + index));
  const historyProduct = product("ZZZ-HISTORIAL", "Marco histórico " + tag);
  const transferProduct = product("AAA-TRASPASO", "Marco para traspasos " + tag);
  const privateProduct = product("ZZZ-PRIVADO", "Marco privado " + tag);
  const createdAt = new Date("2025-01-15T12:00:00.123Z");

  const transfer = (source, destination, status) => ({
    id: randomUUID(),
    source_id: source.id,
    destination_id: destination.id,
    product_id: transferProduct.id,
    quantity: 1,
    status,
    reason: "Traspaso sintético",
    created_by: ids.admin,
    request_key: randomUUID(),
    created_at: createdAt,
  });
  const completed = Array.from({ length: 120 }, () => transfer(main, other, "RECEIVED"));
  const inbound = { ...transfer(other, main, "DISPATCHED"), created_at: new Date("2025-01-01") };
  const outbound = { ...transfer(main, other, "DISPATCHED"), created_at: new Date("2025-01-02") };
  const unrelated = transfer(privateBranch, other, "RECEIVED");

  const stockGroups = [
    [historyProduct, main, 120],
    [transferProduct, main, 1],
    [transferProduct, other, 1],
    [privateProduct, privateBranch, 1],
    ...others.map((item) => [item, main, 1]),
  ];
  const movements = stockGroups.flatMap(([item, branch, count]) => Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    branch_id: branch.id,
    product_id: item.id,
    stock_version: index + 1,
    kind: index === 0 ? "COUNT" : "ENTRY",
    before_on_hand: index === 0 ? null : 29 + index,
    after_on_hand: 30 + index,
    before_reserved: 0,
    after_reserved: 0,
    reason: "Movimiento sintético " + (index + 1),
    actor_id: ids.admin,
    created_at: createdAt,
  })));

  await prisma.$transaction(async (client) => {
    await client.branches.createMany({ data: [main, other, privateBranch] });
    await client.user_branches.create({ data: { user_id: ids.sales, branch_id: main.id } });
    await client.products.createMany({ data: [...others, historyProduct, transferProduct, privateProduct] });
    await client.inventory_stocks.createMany({
      data: stockGroups.map(([item, branch, count]) => ({
        branch_id: branch.id, product_id: item.id, on_hand: 29 + count, version: count,
      })),
    });
    await client.inventory_movements.createMany({ data: movements });
    await client.inventory_transfers.createMany({ data: [...completed, outbound, inbound, unrelated] });
  });

  return {
    main, other, privateBranch, historyProduct, privateProduct, inbound, outbound, unrelated,
    movementIds: movements.filter((row) => row.product_id === historyProduct.id).map((row) => row.id).sort().reverse(),
    transferIds: [...completed.map((row) => row.id).sort().reverse(), outbound.id, inbound.id],
  };
}
