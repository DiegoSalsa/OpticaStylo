import { INTERNAL_PAGE_SIZE } from "./pagination.js";

export function accountPage(items = [], { page = 1, pageSize = INTERNAL_PAGE_SIZE } = {}, total = items.length) {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export function accountPageInfo({ page, pageSize, total, totalPages }) {
  return { page, pageSize, total, totalPages };
}

export async function readAccountPage(model, { page: requestedPage = 1, pageSize = INTERNAL_PAGE_SIZE }, { where, ...options }) {
  const total = await model.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const items = total === 0 ? [] : await model.findMany({ ...options, where, skip: (page - 1) * pageSize, take: pageSize });
  return accountPage(items, { page, pageSize }, total);
}
