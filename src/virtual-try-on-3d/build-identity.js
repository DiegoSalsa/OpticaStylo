// Public, non-secret build identity embedded in the actual client bundle.
// It remains the identity of a stale bundle if a CDN/browser serves old code.
export const VTO_BUILD_IDENTITY = Object.freeze({
  commit: process.env.NEXT_PUBLIC_VTO_COMMIT ?? "unavailable",
  branch: process.env.NEXT_PUBLIC_VTO_BRANCH ?? "unavailable",
  dirty: process.env.NEXT_PUBLIC_VTO_DIRTY === "true",
  builtAt: process.env.NEXT_PUBLIC_VTO_BUILT_AT ?? "unavailable",
  deployment: process.env.NEXT_PUBLIC_VTO_DEPLOYMENT || null,
});
