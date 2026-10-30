import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getStoreCart } from "@/services/store-service";
import { listInventoryBranches } from "@/repositories/inventory-repository";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const cart = await getStoreCart(getStoreCartToken(request), account);
    const branches = (await listInventoryBranches()).filter((b) => b.pickupEnabled);
    return response(branches.map((branch) => {
      const shortages = cart.items.filter((item) => {
        const stock = item.availability?.branches.find((b) => b.id === branch.id);
        return !stock?.available || (stock.quantity !== null && stock.quantity < item.quantity);
      });
      return { ...branch, available: cart.items.length > 0 && !shortages.length, shortages: shortages.map((item) => item.name) };
    }));
  });
}
