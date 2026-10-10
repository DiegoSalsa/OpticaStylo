import assert from "node:assert/strict";
import test from "node:test";
import { canReadCommercialReports, dashboardResult, metricValue } from "../../src/utils/dashboard.js";

test("dashboard reconoce ambos permisos comerciales sin ampliar otros accesos", () => {
  assert.equal(canReadCommercialReports({permissions:["sales.reports_read"]}),true);
  assert.equal(canReadCommercialReports({permissions:["reports.read"]}),true);
  assert.equal(canReadCommercialReports({permissions:["sales.read"]}),false);
});
test("fallo y falta de permisos nunca se presentan como cero real", () => {
  const failed = dashboardResult({status:"rejected",reason:new Error("Consulta fallida")});
  assert.equal(metricValue(failed,()=>"0"),"No disponible");
  assert.equal(failed.error,"Consulta fallida");
  assert.equal(metricValue(dashboardResult({status:"fulfilled",value:null}),()=>"0"),"Sin acceso");
  assert.equal(metricValue(null,()=>"0"),"Cargando…");
  assert.equal(metricValue(dashboardResult({status:"fulfilled",value:{inProcess:243}}),(value)=>String(value.inProcess)),"243");
});
