"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, Table, TextInput } from "@medpass/ui-web";
import { ProviderShell } from "../../components/ProviderShell";
import { Select } from "../../components/Select";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { ORGANIZATION_KIND_LABELS } from "../../lib/proposal-kinds";
import { useProviderSession } from "../../lib/session";
import type { MemberDto, MemberRole, OrganizationDto } from "../../lib/types";

const ROLES: Array<{ value: MemberRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "doctor", label: "Doctor" },
  { value: "staff", label: "Staff" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "lab_tech", label: "Lab technician" },
];
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/** Organization details (owner edits) and member management (owner only; docs_v2/05 §11). */
export default function OrganizationPage() {
  return (
    <ProviderShell>
      <OrganizationView />
    </ProviderShell>
  );
}

function OrganizationView() {
  const { organization, isOwner, refresh } = useProviderSession();
  if (!organization) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{organization.displayName}</h1>
      <Details organization={organization} editable={isOwner} onSaved={refresh} />
      {isOwner ? <Members /> : <Banner tone="info">Only an organization owner can manage members.</Banner>}
    </div>
  );
}

function Details({ organization, editable, onSaved }: { organization: OrganizationDto; editable: boolean; onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(organization.displayName);
  const [addressText, setAddressText] = useState(organization.addressText ?? "");
  const [city, setCity] = useState(organization.city ?? "");
  const [state, setState] = useState(organization.state ?? "");
  const [pincode, setPincode] = useState(organization.pincode ?? "");
  const [phone, setPhone] = useState(organization.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | undefined>();

  useEffect(() => {
    setDisplayName(organization.displayName);
    setAddressText(organization.addressText ?? "");
    setCity(organization.city ?? "");
    setState(organization.state ?? "");
    setPincode(organization.pincode ?? "");
    setPhone(organization.phone ?? "");
  }, [organization]);

  async function save() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.patch("/provider/organizations/current", {
        displayName: displayName.trim(),
        addressText: addressText.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        pincode: pincode.trim() || null,
        phone: phone.trim() || null,
      });
      await onSaved();
      setMessage({ tone: "success", text: "Saved." });
    } catch (err) {
      setMessage({ tone: "danger", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // Same discipline as the PIN code: a field showing an inline error never
  // leaves Save enabled. Posting anyway only turned a message the owner had
  // already been given into a 400 from the server.
  const pincodeInvalid = !!pincode && !/^\d{6}$/.test(pincode);
  const phoneInvalid = !!phone.trim() && !PHONE_RE.test(phone.replace(/[\s-]/g, ""));

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          <span>{ORGANIZATION_KIND_LABELS[organization.kind] ?? organization.kind}</span>
          <span>Verification: {organization.verification.replace(/_/g, " ")}</span>
          <span>{organization.memberCount} active member{organization.memberCount === 1 ? "" : "s"}</span>
          {organization.hfrId ? <span>HFR {organization.hfrId}</span> : null}
        </div>
        {editable ? (
          <>
            <TextInput label="Organization name" value={displayName} maxLength={160} onChange={(e) => setDisplayName(e.target.value)} />
            <TextInput label="Address" value={addressText} maxLength={500} onChange={(e) => setAddressText(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)" }}>
              <TextInput label="City" value={city} maxLength={100} onChange={(e) => setCity(e.target.value)} />
              <TextInput label="State" value={state} maxLength={100} onChange={(e) => setState(e.target.value)} />
              <TextInput label="PIN code" inputMode="numeric" value={pincode} maxLength={6} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} error={pincodeInvalid ? "6 digits" : undefined} />
            </div>
            <TextInput label="Organization phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={phoneInvalid ? "With country code, e.g. +91…" : undefined} />
            {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
            <Button onClick={() => void save()} loading={busy} disabled={busy || !displayName.trim() || pincodeInvalid || phoneInvalid} data-testid="save-organization">
              Save details
            </Button>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            {organization.addressText ? <span>{organization.addressText}</span> : null}
            <span>{[organization.city, organization.state, organization.pincode].filter(Boolean).join(", ") || "No address on file"}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function Members() {
  const [members, setMembers] = useState<MemberDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [phone, setPhone] = useState("+91");
  const [role, setRole] = useState<MemberRole | "">("staff");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  async function load() {
    setError(undefined);
    try {
      setMembers((await api.get<{ items: MemberDto[] }>("/provider/organizations/current/members")).items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const normalizedPhone = phone.replace(/[\s-]/g, "");

  async function addMember() {
    setBusy(true);
    setFormError(undefined);
    try {
      await api.post("/provider/organizations/current/members", { phone: normalizedPhone, role: role || "staff" });
      setPhone("+91");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError && err.problem.code === "validation_failed" ? "Already a member, or the number is not valid." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function update(member: MemberDto, patch: { role?: MemberRole; status?: "active" | "suspended" }) {
    setError(undefined);
    try {
      await api.patch(`/provider/organizations/current/members/${encodeURIComponent(member.id)}`, patch);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : errorMessage(err));
    }
  }

  async function remove(member: MemberDto) {
    if (!window.confirm(`Remove ${member.phone} from this organization? Their access ends immediately.`)) return;
    setError(undefined);
    try {
      await api.delete(`/provider/organizations/current/members/${encodeURIComponent(member.id)}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : errorMessage(err));
    }
  }

  return (
    <section aria-labelledby="members-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <h2 id="members-heading" style={{ fontSize: "var(--font-large)", margin: 0 }}>
        Members
      </h2>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!members && !error ? <PillSpinner label="Loading members…" /> : null}
      {members ? (
        <Table<MemberDto>
          columns={[
            { key: "phone", header: "Phone", render: (m) => m.phone },
            {
              key: "role",
              header: "Role",
              render: (m) => (
                <Select<MemberRole> label={`Role for ${m.phone}`} options={ROLES} value={m.role} onChange={(v) => v && void update(m, { role: v })} style={{ minWidth: 140 }} />
              ),
            },
            { key: "status", header: "Status", render: (m) => m.status },
            {
              key: "actions",
              header: "Actions",
              render: (m) => (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
                  <Button variant="secondary" onClick={() => void update(m, { status: m.status === "active" ? "suspended" : "active" })}>
                    {m.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                  <Button variant="danger" onClick={() => void remove(m)}>
                    Remove
                  </Button>
                </div>
              ),
            },
          ]}
          rows={members}
          rowKey={(m) => m.id}
          emptyLabel="No members yet"
          // On a phone the last two columns were squeezed off the edge with
          // nothing to say the table went further. Let it be its own width
          // and scroll, and say so while it is actually scrolling.
          minWidth={640}
          scrollHint="Scroll sideways for status, suspend and remove."
        />
      ) : null}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addMember();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <strong>Add a member by phone</strong>
          <TextInput label="Phone number" type="tel" inputMode="tel" help="They sign in with this number and a one-time code." value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select<MemberRole> label="Role" options={ROLES} value={role} onChange={setRole} />
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <Button type="submit" loading={busy} disabled={busy || !PHONE_RE.test(normalizedPhone) || !role}>
            Add member
          </Button>
        </form>
      </Card>
    </section>
  );
}
