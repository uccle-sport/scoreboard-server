#!/usr/bin/env node
// Pre-fetches channel logos from the Flowr CMS into packages/app/public/channels
// so the admin app serves them directly (at /admin/channels/<logo>.png) instead
// of proxying each one through the server with a bearer token. The /ozone/view
// endpoint requires a logged-in session, so pass a fresh DSID session cookie:
//
//   DSID=<your-session-cookie> node packages/app/scripts/fetch-channel-logos.mjs
//
// Files are keyed by the channel's `logo` UUID, which is exactly what
// loadChannels() in packages/server/src/socket.ts uses to build the image URL.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DSID = process.env.DSID;
if (!DSID) {
  console.error("Set the DSID env var to a valid Flowr session cookie.");
  process.exit(1);
}

const HOST = process.env.FLOWR_HOST ?? "https://sportlab.flowr.cloud";
const TENANT = process.env.FLOWR_TENANT ?? "4f8c271a-8130-4e75-a1e4-ec1efee860be";
const PACKAGE = process.env.FLOWR_PACKAGE ?? "f66e97e6-e452-4e5d-afcc-66fbb754992d";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/channels");

const commonHeaders = {
  cookie: `DSID=${DSID}`,
  referer: `${HOST}/`,
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};

// Flowr serves a logo at /ozone/view/<viewId>/... where viewId is the decimal
// value of the logo UUID's last group (same derivation as the server).
const viewId = (logo) => parseInt(logo.split("-").pop(), 16);

async function main() {
  const res = await fetch(`${HOST}/ozone/rest/v3/items/channel/search`, {
    method: "POST",
    headers: { ...commonHeaders, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      query: {
        $type: "BoolQuery",
        mustClauses: [
          { $type: "TenantQuery", tenantId: TENANT, mode: "OWN_AND_PARENTS" },
          { $type: "TermsQuery", field: "packages", values: [PACKAGE] },
        ],
      },
      offset: 0,
      sorts: [],
      size: 100,
    }),
  });
  if (!res.ok) throw new Error(`channel search failed: HTTP ${res.status}`);

  const { results = [] } = await res.json();
  const channels = results.filter((c) => c.logo);
  await mkdir(outDir, { recursive: true });

  let ok = 0;
  const failures = [];
  for (const c of channels) {
    const url = `${HOST}/ozone/view/${viewId(c.logo)}/org.taktik.filetype.original`;
    const img = await fetch(url, { headers: commonHeaders });
    if (!img.ok) {
      failures.push(`${c.name} (${c.logo}): HTTP ${img.status}`);
      continue;
    }
    await writeFile(
      path.join(outDir, `${c.logo}.png`),
      Buffer.from(await img.arrayBuffer())
    );
    ok += 1;
  }

  console.log(`Cached ${ok}/${channels.length} channel logos into ${outDir}`);
  if (failures.length) {
    console.error("Failed:\n  " + failures.join("\n  "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
