import { loadProjectEnvironment } from "./load-environment.mjs";
loadProjectEnvironment();
const e=process.env, failures=[];
if(e.DEPLOYMENT_ENVIRONMENT!=="staging" || e.VERCEL_ENV!=="preview") failures.push("Dedicated staging/preview environment required");
if(e.STAGING_ACCESS_RESTRICTION_CONFIRMED!=="true") failures.push("Verify remote deployment protection before deployment");
try {const u=new URL(e.APP_PUBLIC_URL);if(u.protocol!=="https:" || u.username || u.password)throw Error();} catch {failures.push("Dedicated HTTPS public staging origin required");}
try { const u=new URL(e.DATABASE_URL);if(e.STAGING_DATABASE_ISOLATED!=="true" || !/^stylo_staging_[a-f0-9]{16}$/.test(u.searchParams.get("schema")??"")) throw Error(); } catch {failures.push("Dedicated synthetic staging database/schema not confirmed");}
if(e.EMAIL_MODE!=="disabled" || e.CHILEXPRESS_MODE!=="disabled" || e.OPENAI_PRESCRIPTION_READER_ENABLED!=="false" || e.MERCADO_PAGO_PRODUCTION_ENABLED!=="false" || e.CHILEXPRESS_ORDERS_ENABLED!=="false" || e.OPERATIONS_ENABLED!=="false") failures.push("Disable providers and scheduled operations for initial staging");
if(Object.entries(e).some(([key,value])=>value && /^(MERCADO_PAGO|CHILEXPRESS|CLOUDINARY|RESEND|OPENAI)_.*(TOKEN|KEY|SECRET|TCC)$/.test(key))) failures.push("Remove provider credentials from initial staging");
console.log(JSON.stringify({ready:!failures.length,failures,remoteValidated:false,deploy:false},null,2));
if(failures.length) process.exitCode=1;
