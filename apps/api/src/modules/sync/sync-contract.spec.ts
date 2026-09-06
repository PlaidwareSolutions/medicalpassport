import { SYNC_MUTATIONS, syncMutationKey } from "@medpass/offline-sync";
import { DISPATCHED_SYNC_MUTATIONS, requiredActionFor } from "./sync-dispatch";

/**
 * P0-8 drift gate (docs_v2/06): the (entity, operation) pairs the shared
 * offline contract lets a client queue must be exactly the pairs
 * `POST /v1/sync` dispatches. No DB — pure set comparison.
 */
describe("sync contract == dispatcher", () => {
  const contract = SYNC_MUTATIONS.map(syncMutationKey).sort();
  const dispatched = DISPATCHED_SYNC_MUTATIONS.map(syncMutationKey).sort();

  it("dispatches exactly the pairs the contract declares", () => {
    expect(dispatched).toEqual(contract);
  });

  it("declares each pair once on both sides", () => {
    expect(new Set(contract).size).toBe(contract.length);
    expect(new Set(dispatched).size).toBe(dispatched.length);
  });

  it("resolves a permission scope for every contract pair and none for anything else", () => {
    for (const kind of SYNC_MUTATIONS) expect(requiredActionFor(kind.entity, kind.operation)).toBeDefined();
    expect(requiredActionFor("patient_medication", "soft_delete")).toBeUndefined();
    expect(requiredActionFor("allergy", "create")).toBeUndefined();
  });

  it("registers the §14 entities with the scopes their direct endpoints require", () => {
    expect(contract).toContain("observation:create");
    expect(contract).toContain("document_upload_intent:create");
    expect(requiredActionFor("observation", "create")).toBe("add_measurements");
    expect(requiredActionFor("document_upload_intent", "create")).toBe("upload_documents");
    // Only creates are offline-capable for these — an offline delete of a reading is not in the contract.
    expect(requiredActionFor("observation", "update")).toBeUndefined();
    expect(requiredActionFor("document_upload_intent", "update")).toBeUndefined();
  });
});
