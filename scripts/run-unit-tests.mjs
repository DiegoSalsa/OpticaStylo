import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const files=[];
for(const directory of ["app","auth","config","db","integrations","repositories","security","services","utils","validations","virtual-try-on-3d"]) {
  for(const file of await readdir(`tests/${directory}`)) if(file.endsWith(".test.js")) files.push(`tests/${directory}/${file}`);
}
// A missing mock must fail, never reach the configured application database or
// reuse provider credentials from the operator's shell.
const allowed=/^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|ci)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key)));
Object.assign(env,{DATABASE_URL:"postgresql://disabled@127.0.0.1:1/no_connection?connect_timeout=1",EMAIL_MODE:"disabled",CHILEXPRESS_MODE:"disabled",OPENAI_PRESCRIPTION_READER_ENABLED:"false"});
const child=spawn(process.execPath,["--test","--test-concurrency=2",...files.sort()],{env,stdio:"inherit",windowsHide:true});
child.once("error",()=>{process.exitCode=1;});
child.once("exit",code=>{process.exitCode=code??1;});
