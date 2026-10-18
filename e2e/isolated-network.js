export async function isolateBrowserNetwork(context) {
  if(process.env.ACADEMIC_ISOLATION!=="true") return;
  await context.route("**/*",async(route)=>{
    const url=new URL(route.request().url());
    if(["localhost","127.0.0.1"].includes(url.hostname)) await route.continue();
    else await route.abort();
  });
}
