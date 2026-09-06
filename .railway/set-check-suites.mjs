/**
 * Turns on Railway's "wait for CI" gate (docs_v2/19 ticket 0.2).
 *
 * Until this runs, every deployment trigger has checkSuites=false, so a red
 * GitHub Actions run still deploys — on medpass-prod, straight to the
 * environment the pilot patients use.
 *
 * Only ever touches the two project ids passed on the command line, and only
 * the `checkSuites` field. Reads the state back afterwards rather than
 * trusting the mutation's own response.
 *
 * Usage: node set-check-suites.mjs <projectId> [--apply]
 * Without --apply it only reports what it would change.
 */
const API = "https://backboard.railway.com/graphql/v2";
const TOKEN = process.env.RAILWAY_API_TOKEN;
const [projectId, ...flags] = process.argv.slice(2);
const APPLY = flags.includes("--apply");

if (!TOKEN) throw new Error("RAILWAY_API_TOKEN is required");
if (!projectId) throw new Error("project id is required");

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
  return body.data;
}

async function triggers() {
  const d = await gql(
    `query ($id: String!) { project(id: $id) { name deploymentTriggers { edges { node { id branch checkSuites serviceId } } } } }`,
    { id: projectId },
  );
  return { name: d.project.name, list: d.project.deploymentTriggers.edges.map((e) => e.node) };
}

const before = await triggers();
const stale = before.list.filter((t) => !t.checkSuites);
console.log(`${before.name}: ${before.list.length} triggers, ${stale.length} without the CI gate`);

if (!APPLY) {
  console.log("dry run — pass --apply to change them");
  process.exit(0);
}

for (const t of stale) {
  await gql(
    `mutation ($id: String!, $input: DeploymentTriggerUpdateInput!) { deploymentTriggerUpdate(id: $id, input: $input) { id checkSuites } }`,
    { id: t.id, input: { checkSuites: true } },
  );
}

// Verify from a fresh read, not from the mutation responses.
const after = await triggers();
const remaining = after.list.filter((t) => !t.checkSuites);
console.log(`${after.name}: ${after.list.filter((t) => t.checkSuites).length}/${after.list.length} now gated on CI`);
if (remaining.length > 0) {
  console.error(`still ungated: ${remaining.map((t) => t.serviceId).join(", ")}`);
  process.exit(1);
}
