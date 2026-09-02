import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = new URL("../../.github/workflows/", import.meta.url);

async function readWorkflow(name) {
  return readFile(new URL(name, workflowDirectory), "utf8");
}

test("el despliegue universitario queda limitado al runner y a main", async () => {
  const workflow = await readWorkflow("despliegueuniversidad.yml");

  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /DESPLIEGUE_UNIVERSIDAD_HABILITADO == 'true'/);
  assert.match(workflow, /runs-on: \[self-hosted, linux, x64, opticastylo-universidad\]/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /schedule:/);
});
