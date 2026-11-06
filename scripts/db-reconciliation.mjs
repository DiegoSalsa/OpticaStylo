import { loadProjectEnvironment } from "./load-environment.mjs";
loadProjectEnvironment();
const {prisma}=await import("../src/db/prisma.js");
// Counts only. Never infer a branch, stock, customer identity or clinical data.
try {
  const rows=await prisma.$queryRaw`SELECT
    (SELECT count(*) FROM sales WHERE branch_id IS NULL)::int AS sales_without_branch,
    (SELECT count(*) FROM cash_register_sessions WHERE terminal_id IS NULL)::int AS cash_without_terminal,
    (SELECT count(*) FROM sales WHERE fulfillment_method='DELIVERY' AND shipping_quote_id IS NULL)::int AS deliveries_without_logistics,
    (SELECT count(*) FROM sales WHERE shipping_quote_source IN ('MOCK','EXTERNAL'))::int AS legacy_shipping,
    (SELECT count(*) FROM products p WHERE p.inventory_mode='TRACKED' AND NOT EXISTS(SELECT 1 FROM inventory_stocks s WHERE s.product_id=p.id))::int AS tracked_products_without_counts,
    (SELECT count(*) FROM customers WHERE rut IS NULL)::int AS customers_without_rut,
    (SELECT count(*) FROM (SELECT ltrim(upper(regexp_replace(rut,'[^0-9kK]','','g')),'0') AS normalized FROM customers WHERE rut IS NOT NULL GROUP BY normalized HAVING count(*)>1) d)::int AS possible_duplicate_rut_groups,
    (SELECT count(*) FROM clinical_encounters WHERE status='FINALIZED')::int AS finalized_encounters_preserved,
    (SELECT count(*) FROM external_prescriptions WHERE file_data IS NOT NULL)::int AS legacy_private_images`;
  console.log(JSON.stringify({readOnly:true,counts:rows[0],humanReview:["sales_without_branch","cash_without_terminal","deliveries_without_logistics","legacy_shipping","tracked_products_without_counts","customers_without_rut","possible_duplicate_rut_groups"],automaticUpdates:0},null,2));
} finally {await prisma.$disconnect();}
