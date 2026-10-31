import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { database } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { clinicalDemo as d, optometryData, contactologyData } from "./data.js";
import {clinicalDateToday} from "../../src/config/clinical-forms.js";
const section = (page, title) => page.locator("details.clinical-form-section").filter({
  has: page.locator(":scope > summary", {
    hasText: new RegExp(`^${title}$`)
  })
});
async function expandOfficialSections(page){
  for(const item of await page.locator("details.clinical-form-section").all()){
    const title=await item.locator(":scope > summary").innerText();
    if(title==="Información clínica complementaria")continue;
    if(await item.getAttribute("open")===null)await item.locator(":scope > summary").click();
  }
}
async function fill(scope, label, value) {
  if(label==="Contraseña")return scope.getByLabel(label,{exact:true}).fill(String(value));
  await scope.getByRole("textbox", {name:label,
    exact: true
  }).fill(value == null ? "" : String(value));
}
async function login(page) {
  await page.goto("/ingresar");
  await fill(page, "Correo electrónico", d.email);
  await fill(page, "Contraseña", evaluation.password);
  await page.getByRole("button", {
    name: "Ingresar de forma segura",
    exact: true
  }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/ficha-clinica");
  await page.getByRole("button", {
    name: /Paciente clínico sintético Prueba A/
  }).click();
  await expect(page.getByRole("heading", {
    name: "Historial del paciente",
    exact: true
  })).toBeVisible();
}
test.beforeEach(async () => {
  const db = database();
  try {
    await db.public_request_rate_limits.deleteMany();
  } finally {
    await db.$disconnect();
  }
});
test("Conflicto conserva el borrador local y recarga solo con confirmación",async({page})=>{
  await login(page);
  const response=await page.request.post("/api/clinical-encounters",{headers:{"X-Idempotency-Key":randomUUID()},data:{patientId:d.patientId,encounterType:"OPTOMETRY",encounterDate:clinicalDateToday(),reasonForVisit:"Concurrencia UI sintética"}});
  expect(response.status()).toBe(201);const e=(await response.json()).data;
  await page.reload();await page.getByRole("button",{name:/Paciente clínico sintético Prueba A/}).click();await page.getByRole("button").filter({hasText:new RegExp(`Ficha ${e.recordNumber}$`)}).click();
  await fill(page,"Anamnesis","Trabajo local que debe conservarse");
  expect((await page.request.patch(`/api/clinical-encounters/${e.id}`,{data:{expectedVersion:1,anamnesis:"Cambio de otra sesión"}})).status()).toBe(200);
  await page.getByRole("button",{name:"Guardar borrador",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"otra sesión"})).toBeVisible();await expect(page.getByRole("textbox",{name:"Anamnesis",exact:true})).toHaveValue("Trabajo local que debe conservarse");
  page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"Recargar ficha guardada",exact:true}).click();await expect(page.getByRole("textbox",{name:"Anamnesis",exact:true})).toHaveValue("Trabajo local que debe conservarse");
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Recargar ficha guardada",exact:true}).click();await expect(page.getByRole("textbox",{name:"Anamnesis",exact:true})).toHaveValue("Cambio de otra sesión");
});
for (const type of ["OPTOMETRY", "CONTACTOLOGY"]) test(`${type}: guardar todos los campos, recuperar, finalizar e imprimir`, async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await login(page);
  await page.getByRole("combobox", {
    name: "Tipo de ficha",
    exact: true
  }).selectOption(type);
  const marker = `Navegador clínico ${randomUUID()}`;
  await fill(page, "Motivo inicial", marker);
  const creating = page.waitForResponse(r => r.url().endsWith("/api/clinical-encounters") && r.request().method() === "POST");
  await page.getByRole("button", {
    name: "Crear borrador clínico",
    exact: true
  }).click();
  const response = await creating;
  expect(response.status()).toBe(201);
  const created = (await response.json()).data;
  await expect(page.getByRole("heading", {
    name: type === "OPTOMETRY" ? "Atención optométrica" : "Atención de contactología",
    exact: true
  })).toBeVisible();
  await fill(page, "Anamnesis", "Anamnesis del navegador");
  await expandOfficialSections(page);
  const expected = type === "OPTOMETRY" ? optometryData() : contactologyData();
  if (type === "OPTOMETRY") {
    await page.getByRole("combobox", {
      name: "AG",
      exact: true
    }).selectOption("true");
    await fill(page, "Detalle AG", expected.ag.notes);
    await page.getByRole("combobox", {
      name: "AF",
      exact: true
    }).selectOption("false");
    await fill(page, "Detalle AF", expected.af.notes);
    await page.getByRole("combobox", {
      name: "Usuario actual de lentes",
      exact: true
    }).selectOption("true");
    await page.getByRole("combobox", {
      name: "Tipo de lentes",
      exact: true
    }).selectOption("MULTIFOCAL");
    const av = section(page, "Examen de agudeza visual");
    for (const [eye, label] of [["rightEye", "OD"], ["leftEye", "OI"]]) {
      const group = av.getByRole("group", {
        name: label,
        exact: true
      });
      await fill(group, "Sin corrección de lejos", expected.visualAcuity[eye].uncorrected);
      await fill(group, "Con sus lentes de lejos", expected.visualAcuity[eye].withGlasses);
    }
    await fill(page, "PL", expected.rp.pl);
    await fill(page, "PC", expected.rp.pc);
    await fill(page, "Observaciones", expected.observations);
  } else {
    for (const [title, key, columns] of [["Agudeza visual", "visualAcuity", [["sc", "SC"], ["cc", "CC"], ["cclc", "CC.lc"]]], ["Diámetro iris", "irisDiameter", [["value", "Diámetro iris"], ["unit", "Unidad consignada"]]], ["Refracción", "refraction", [["sphere", "ESF"], ["cylinder", "CIL"], ["axis", "EJE"], ["addition", "ADD"]]], ["Sobrerrefracción", "overRefraction", [["sphere", "ESF"], ["cylinder", "CIL"], ["axis", "EJE"], ["acuity", "AV.clc"]]]]) {
      for (const [eye, label] of [["rightEye", "OD"], ["leftEye", "OI"]]) {
        const group = section(page, title).getByRole("group", {
          name: label,
          exact: true
        });
        for (const [field, name] of columns) {
          const v = expected[key][eye][field];
          await fill(group, name, typeof v === "number" && field === "sphere" && v > 0 ? `+${Math.round(v * 100) / 100}` : v);
        }
      }
    }
    await fill(page, "Hallazgos preadaptación", expected.preAdaptation);
    await fill(page, "Hallazgos postadaptación", expected.postAdaptation);
    for (const [key, title, button, cols] of [["trialLenses", "Lente de prueba", "Agregar lente de prueba", [["lens", "Lente de prueba"], ["sphere", "ESF"], ["cylinder", "CIL"], ["axis", "EJE"], ["acuity", "AV"], ["notes", "Observaciones"]]], ["finalLenses", "Lente final", "Agregar lente final", [["lens", "Lente final"], ["sphere", "ESF"], ["cylinder", "CIL"], ["axis", "EJE"], ["lcType", "Tipo de LC"]]]]) {
      for (const [i, row] of expected[key].entries()) {
        await page.getByRole("button", {
          name: button,
          exact: true
        }).click();
        const group = page.getByRole("group", {
          name: `${title} ${i + 1}`,
          exact: true
        });
        await group.getByRole("combobox", {
          name: "Lateralidad",
          exact: true
        }).selectOption(row.eye);
        for (const [field, name] of cols) await fill(group, name, row[field]);
        if (key === "finalLenses") {
          await fill(group, "Diámetro", row.diameter.value);
          await fill(group, "Unidad del diámetro", row.diameter.unit);
        }
      }
    }
    const third = page.getByRole("group", {
      name: "Lente de prueba 3",
      exact: true
    });
    await third.getByRole("button", {
      name: "Subir fila",
      exact: true
    }).click();
    [expected.trialLenses[1], expected.trialLenses[2]] = [expected.trialLenses[2], expected.trialLenses[1]];
    expected.overRefraction.rightEye.sphere = 0.3;
  }
  const saving = page.waitForResponse(r => r.url().endsWith(`/api/clinical-encounters/${created.id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", {
    name: "Guardar borrador",
    exact: true
  }).click();
  expect((await saving).status()).toBe(200);
  await expect(page.getByRole("status").filter({
    hasText: "Borrador guardado"
  })).toBeVisible();
  const db = database();
  try {
    const row = await db.clinical_encounters.findUniqueOrThrow({
      where: {
        id: created.id
      }
    });
    expect(row.form_data).toEqual(expected);
    expect(row.anamnesis).toBe("Anamnesis del navegador");
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  await page.getByRole("button", {
    name: /Paciente clínico sintético Prueba A/
  }).click();
  await page.getByRole("button").filter({
    hasText: `Ficha ${created.recordNumber}`
  }).click();
  await expect(page.getByRole("textbox", {name:"Anamnesis",
    exact: true
  })).toHaveValue("Anamnesis del navegador");
  await expandOfficialSections(page);
  if (type === "CONTACTOLOGY") await expect(section(page, "Refracción").getByRole("group", {
    name: "OD",
    exact: true
  }).getByRole("textbox", {name:"ESF",
    exact: true
  })).toHaveValue("+1.1");else await expect(page.getByRole("textbox", {name:"Observaciones",
    exact: true
  })).toHaveValue(expected.observations);
  await page.screenshot({
    path: test.info().outputPath(`${type}-recuperada.png`),
    fullPage: true
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", {
    name: "Finalizar atención",
    exact: true
  }).click();
  await expect(page.getByText("Finalizada · registro inmutable", {
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("textbox", {name:"Anamnesis",
    exact: true
  })).toBeDisabled();
  await fill(page, "Motivo de la adenda", "Corrección desde navegador");
  await fill(page, "Contenido de la adenda", "Contenido sintético de corrección");
  await page.getByRole("button", {
    name: "Agregar adenda",
    exact: true
  }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Adenda permanente guardada"
  })).toBeVisible();
  const print = await page.request.get(`/api/clinical-encounters/${created.id}/print`);
  expect(print.status()).toBe(200);
  expect(await print.text()).toContain("Contenido sintético de corrección");
  const printPage=await page.context().newPage();
  await printPage.goto(`/api/clinical-encounters/${created.id}/print`);
  await printPage.emulateMedia({media:"print"});
  await printPage.screenshot({path:test.info().outputPath(`${type}-impresion.png`),fullPage:true});
  expect(await printPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await printPage.close();
  expect(errors).toEqual([]);
});

