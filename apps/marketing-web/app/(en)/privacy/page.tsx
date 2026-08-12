import type { Metadata } from "next";
import { pageMetadata } from "../../../lib/seo";
import { LegalPage, LegalSectionBlock, type LegalSection } from "../../../components/LegalPage";

/**
 * Draft Privacy Policy (Session 12, SPEC §29). Content is grounded in the
 * verified data inventory (docs/landing-page/privacy-data-inventory.md), written
 * in plain language for patients. It is DRAFT — not counsel-approved — and stays
 * noindexed (page-level here + staging host-level) until OD-LP-6 sign-off.
 * Placeholders are intentional and reviewer-visible; the production build guard
 * blocks them from shipping.
 */
export const metadata: Metadata = {
  ...pageMetadata("en", "privacy", "Privacy policy (draft) | Medicine Passport", "Draft privacy policy for Medicine Passport by MediDocs — under legal review."),
  robots: { index: false, follow: false },
};

const sections: LegalSection[] = [
  { id: "who", title: "Who we are" },
  { id: "info-you-give", title: "Information you give us" },
  { id: "health", title: "Your medicine and health information" },
  { id: "caregivers", title: "Caregivers and dependents" },
  { id: "documents", title: "Documents you upload" },
  { id: "sharing", title: "Sharing with doctors and pharmacists" },
  { id: "clinics", title: "If you contact us as a clinic or professional" },
  { id: "technical", title: "Information collected automatically" },
  { id: "why", title: "Why we use your information" },
  { id: "providers", title: "Service providers who help us" },
  { id: "location", title: "Where your information is processed" },
  { id: "security", title: "How we protect your information" },
  { id: "retention", title: "How long we keep your information" },
  { id: "rights", title: "Your rights and choices" },
  { id: "deletion", title: "Deleting your information" },
  { id: "children", title: "Children and guardians" },
  { id: "disclosures", title: "When we may share information" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "How to contact us" },
];

const p: React.CSSProperties = { margin: 0 };

export default function Page() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="Medicine Passport is a place for you to keep your own medicine information and share it when you choose. This policy explains, in plain language, what information Medicine Passport has about you, why, who might receive it, and how you can ask us to correct or delete it."
      sections={sections}
    >
      <LegalSectionBlock id="who" title="Who we are">
        <p style={p}>
          Medicine Passport is a product of MediDocs, operated by
          {" "}[LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH]. Medicine Passport helps you record your
          medicines and related health information and share a summary with a doctor or pharmacist when
          you want to.
        </p>
        <p style={p}>
          Medicine Passport is not a doctor and does not give medical advice. It does not diagnose,
          prescribe, or tell you to start, stop, or change any medicine.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="info-you-give" title="Information you give us">
        <p style={p}>To create and use your account, we collect:</p>
        <ul>
          <li><strong>Your phone number</strong> — used to sign you in with a one-time code. We store it in an encrypted form, not as plain text.</li>
          <li><strong>An email address</strong> — only if you choose to add one.</li>
          <li><strong>Profile details</strong> — a name or label for each person's record, and optionally a year of birth and sex. We ask for the <em>year</em> of birth, not a full date.</li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="health" title="Your medicine and health information">
        <p style={p}>
          Because Medicine Passport is a medicine record, you can add health information such as:
          medicines and doses, why you take them, the prescribing doctor's name, reminders and whether
          doses were taken, allergies, conditions, blood-sugar readings, check-up measurements (like
          blood pressure or HbA1c), and test reports. You decide what to add — most of it is optional.
        </p>
        <p style={p}>
          Medicine Passport keeps your record; it does not analyse it to diagnose you or flag results as
          high or low.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="caregivers" title="Caregivers and dependents">
        <p style={p}>
          You can keep a record for someone you care for (for example, a parent or child), and you can
          invite a caregiver to help manage a record. When you invite a caregiver, we record the
          relationship and the specific permissions you grant, and you can change or revoke them at any
          time. A "caregiver" in the app is a person you have chosen to give access to — it is not the
          same as a legal guardian.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="documents" title="Documents you upload">
        <p style={p}>
          You can take or upload photos of prescriptions, medicine strips or boxes, and test reports.
          These are stored privately and are only accessible to you and the caregivers you allow.
        </p>
        <p style={p}>
          If you use the scan-to-add feature, the text on a document is read <strong>on your own
          device</strong> to suggest medicine details — the image is not sent to an outside text-reading
          service, and you confirm every detail before it is saved.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sharing" title="Sharing with doctors and pharmacists">
        <p style={p}>
          When you choose to share, Medicine Passport creates a link or QR code that shows a summary of
          the sections you selected. The person you share with does not need a MediDocs account. You can
          set the link to expire and you can revoke it.
        </p>
        <p style={p}>
          <strong>Important:</strong> revoking a link stops future access through Medicine Passport. It
          does not delete or claw back a copy that someone has already opened, downloaded, or saved
          (for example, a PDF they kept). We keep a log of accesses so you can see when a link was used.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="clinics" title="If you contact us as a clinic or professional">
        <p style={p}>
          If you fill in our "for doctors &amp; clinics" form, we collect the business contact details
          you provide (name, organization, role, city, and an email or phone) and your message, so we can
          follow up. This form is for professional inquiries — please do not include any patient health
          information in it.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="technical" title="Information collected automatically">
        <p style={p}>
          On our public website, we use Cloudflare Web Analytics to understand overall traffic and page
          performance. It measures aggregate visits and speed — it does not use cookies for tracking and
          does not receive your health information. If you arrive from a link that includes
          <code> ?src=website</code>, we record only the value "website" on your account so we can
          understand where sign-ups come from. We never store the referring site, advertising codes, or
          any other free text there.
        </p>
        <p style={p}>
          We do not run marketing analytics inside the patient app or on your shared record pages.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="why" title="Why we use your information">
        <ul>
          <li>To sign you in and keep your account secure.</li>
          <li>To store and show your medicine and health record to you and the caregivers you allow.</li>
          <li>To send reminders you have turned on.</li>
          <li>To let you share a summary with a doctor or pharmacist when you choose.</li>
          <li>To respond to your requests and to keep the service safe and working.</li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="providers" title="Service providers who help us">
        <p style={p}>We use a small number of trusted providers to run the service:</p>
        <ul>
          <li><strong>Hosting and database</strong> — to run the app and store your record securely.</li>
          <li><strong>Cloudflare</strong> — for our network, security, our public-website analytics, and our private document storage and encrypted backups.</li>
          <li><strong>Telnyx</strong> — to deliver your one-time sign-in code by call or message. It receives your phone number for that purpose.</li>
        </ul>
        <p style={p}>
          These providers act on our instructions. We do not sell your identifiable health information,
          and we do not show advertising inside the patient experience.
          {" "}<em>(This commitment is being finalized in review.)</em>
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="location" title="Where your information is processed">
        <p style={p}>
          We are confirming the exact locations where our providers store and process data, and will
          state them clearly here before launch. [PROCESSING LOCATION — TO BE CONFIRMED WITH PROVIDERS.]
          We will not claim a location we have not verified.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="security" title="How we protect your information">
        <p style={p}>
          We use concrete safeguards, including: encrypted connections; encryption of sensitive fields
          such as your phone number; storing sign-in and share codes only as one-way hashes (never the
          raw code); private document storage with access logging; expiring, revocable share links; bot
          protection and rate limiting on sign-in and forms; and a tamper-evident audit log. No online
          service can promise perfect security, and we do not claim to be "fully secure" or
          "bank-grade" — but we take protecting your information seriously.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="retention" title="How long we keep your information">
        <p style={p}>
          We keep your record for as long as your account is active so it is there when you need it.
          Some technical data is cleared automatically (for example, old sign-in codes and expired
          sessions). We are finalizing clear retention periods for other information and will state them
          here. [RETENTION PERIODS — TO BE CONFIRMED.]
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="rights" title="Your rights and choices">
        <p style={p}>You can:</p>
        <ul>
          <li><strong>See</strong> your information — it is in the app.</li>
          <li><strong>Correct or update</strong> it — you can edit your records.</li>
          <li><strong>Withdraw consent</strong> — for example, revoke a share link or a caregiver's access.</li>
          <li><strong>Ask us to delete</strong> your information (see below).</li>
          <li><strong>Raise a concern or complaint</strong> about how your information is handled.</li>
        </ul>
        <p style={p}>
          Some of these you can do yourself in the app; others you can ask us to do for you. To make a
          request, use the contact details below.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="deletion" title="Deleting your information">
        <p style={p}>
          You can delete individual records in the app. To delete your whole account and record, you can
          send us a request and we will action it. We will confirm what was deleted and note anything we
          must keep for legal or security reasons. Please note that securely-held backups are replaced
          over time rather than edited one by one, so a copy may persist briefly in a backup before it is
          rotated out. We do not promise instant or absolute deletion.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="children" title="Children and guardians">
        <p style={p}>
          A parent or guardian may keep a record for a child they are responsible for. Indian law sets
          specific requirements for the personal data of people under 18, including verifiable consent
          from a parent or lawful guardian. Our approach to this is being finalized with legal review
          before launch. [CHILDREN/GUARDIAN APPROACH — UNDER REVIEW.]
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="disclosures" title="When we may share information">
        <p style={p}>
          Apart from the sharing you choose and the providers listed above, we may disclose information
          if required by law or to protect the safety and security of people or the service. We do not
          sell your identifiable health information.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" title="Changes to this policy">
        <p style={p}>
          We may update this policy. When we make a meaningful change, we will update the date at the top
          and, where appropriate, let you know.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" title="How to contact us">
        <p style={p}>
          For any privacy question, request, or complaint, you will be able to reach our privacy contact
          here. [CONTACT: privacy channel — NOT YET PROVISIONED — OD-LP-7.] We are setting up this
          channel and a grievance process before launch. This draft does not list a contact address
          because we do not publish an address that is not yet monitored.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
