import type { Metadata } from "next";
import { pageMetadata } from "../../../lib/seo";
import { LegalPage, LegalSectionBlock, type LegalSection } from "../../../components/LegalPage";

/**
 * Draft Terms of Use (Session 12, SPEC §31). Grounded in actual product
 * behavior. DRAFT — not counsel-approved — noindexed until OD-LP-6 sign-off.
 * Governing law/venue/entity are intentional placeholders; the production
 * build guard blocks them from shipping.
 */
export const metadata: Metadata = {
  ...pageMetadata("en", "terms", "Terms of use (draft) | Medicine Passport", "Draft terms of use for Medicine Passport by MediDocs — under legal review."),
  robots: { index: false, follow: false },
};

const sections: LegalSection[] = [
  { id: "about", title: "About these terms" },
  { id: "what", title: "What Medicine Passport is" },
  { id: "not-medical", title: "Not medical advice; not for emergencies" },
  { id: "eligibility", title: "Who can use it" },
  { id: "account", title: "Your account and security" },
  { id: "accurate", title: "Keeping information accurate" },
  { id: "caregiver", title: "Caregivers and dependents" },
  { id: "sharing", title: "Sharing your record" },
  { id: "content", title: "Your content" },
  { id: "free", title: "Free for patients" },
  { id: "acceptable", title: "Acceptable use" },
  { id: "availability", title: "Service availability" },
  { id: "termination", title: "Suspension and termination" },
  { id: "third-party", title: "Third-party services" },
  { id: "ip", title: "Our intellectual property" },
  { id: "disclaimers", title: "Disclaimers and liability" },
  { id: "law", title: "Governing law" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact" },
];

const p: React.CSSProperties = { margin: 0 };

export default function Page() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="These terms explain the basics of using Medicine Passport: what it is, what it isn't, your responsibilities, and how sharing works. Please read them alongside our Privacy Policy."
      sections={sections}
    >
      <LegalSectionBlock id="about" title="About these terms">
        <p style={p}>
          These terms are an agreement between you and [LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH],
          which operates Medicine Passport (part of MediDocs). By using Medicine Passport, you agree to
          these terms.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="what" title="What Medicine Passport is">
        <p style={p}>
          Medicine Passport is a tool to help you record your own medicines and related health
          information, set reminders, and share a summary with a doctor or pharmacist when you choose.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="not-medical" title="Not medical advice; not for emergencies">
        <p style={p}>
          Medicine Passport is not a doctor, pharmacy, diagnostic service, or prescribing service. It
          does not give medical advice and does not tell you to start, stop, change, or substitute any
          medicine. Always follow the advice of your own doctor or pharmacist.
        </p>
        <p style={p}>
          <strong>Medicine Passport is not an emergency service.</strong> If you have a medical
          emergency, contact your local emergency services or a healthcare professional immediately.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="eligibility" title="Who can use it">
        <p style={p}>
          You must provide accurate information to use Medicine Passport. Medicine Passport is for adults.
          A person under 18 should not create or run their own adult account; a child's Medicine Passport
          is set up and managed by a parent or lawful guardian. Requirements relating to children and
          guardians are described in our Privacy Policy and are being finalized before launch.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="account" title="Your account and security">
        <p style={p}>
          You sign in with your phone number and a one-time code. Please keep access to your phone and
          device secure. You are responsible for activity in your account. Tell us if you think someone
          else has accessed it.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="accurate" title="Keeping information accurate">
        <p style={p}>
          Medicine Passport shows what you enter. The accuracy of your record depends on you keeping it
          up to date. A summary you share is only as current as the information you have recorded.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="caregiver" title="Caregivers and dependents">
        <p style={p}>
          If you manage a record for someone else, or invite a caregiver, you are responsible for having
          the right to do so and for the permissions you grant. You can change or revoke a caregiver's
          access at any time.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="sharing" title="Sharing your record">
        <p style={p}>
          Sharing is under your control. You choose which sections to include, and you can set a share
          link or QR code to expire and revoke it. Anyone with a valid, unexpired link can view the
          summary you shared — so share only with people you trust.
        </p>
        <p style={p}>
          <strong>Revoking a link stops future access through Medicine Passport.</strong> It does not
          delete or recover a copy that someone has already opened, downloaded, or saved (such as a PDF).
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="content" title="Your content">
        <p style={p}>
          Your records and documents are yours. You give us permission to store and process them only to
          provide the service to you and the people you share with, as described in the Privacy Policy.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="free" title="Free for patients">
        <p style={p}>
          Medicine Passport is free for patients to create, maintain and access their core Medicine
          Passport. Sharing your record with a doctor or pharmacist is included at no charge. We plan to
          sustain MediDocs through services and partnerships with healthcare organizations rather than by
          charging patients for access to their own medicine information.
          {" "}<em>(The final published wording of this commitment is under legal review.)</em>
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="acceptable" title="Acceptable use">
        <p style={p}>
          Please use Medicine Passport only for its intended purpose. Do not misuse it, attempt to break
          its security, access other people's data without permission, or use it to store information you
          have no right to keep.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="availability" title="Service availability">
        <p style={p}>
          We work to keep Medicine Passport available and reliable, but we cannot guarantee it will be
          uninterrupted or error-free. Reminders depend on your device and internet connection.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="termination" title="Suspension and termination">
        <p style={p}>
          You can stop using Medicine Passport at any time and ask us to delete your account. We may
          suspend or limit access if these terms are broken or where necessary to protect users or the
          service.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="third-party" title="Third-party services">
        <p style={p}>
          We rely on trusted providers to run the service (for example, hosting and message delivery),
          described in the Privacy Policy. We are not responsible for third-party websites or services
          you choose to use outside Medicine Passport.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="ip" title="Our intellectual property">
        <p style={p}>
          The Medicine Passport and MediDocs names, software, and design are owned by us or our
          licensors. These terms do not give you rights to them beyond using the service as intended.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="disclaimers" title="Disclaimers and liability">
        <p style={p}>
          Medicine Passport is provided on an "as is" basis to help you keep and share your own
          information; it is not a substitute for professional medical care. The precise disclaimers and
          limitations of liability for this service are under legal review.
          {" "}[DISCLAIMERS &amp; LIABILITY — COUNSEL REVIEW REQUIRED.]
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="law" title="Governing law">
        <p style={p}>
          These terms will be governed by the laws of [GOVERNING LAW — TO BE CONFIRMED], with disputes
          subject to [JURISDICTION / VENUE — TO BE CONFIRMED]. These will be finalized with legal review
          before launch.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="changes" title="Changes to these terms">
        <p style={p}>
          We may update these terms. When we make a meaningful change, we will update the date at the top
          and, where appropriate, let you know.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" title="Contact">
        <p style={p}>
          Questions about these terms can be sent to our contact channel, which we are setting up before
          launch. [CONTACT — NOT YET PROVISIONED — OD-LP-7.] We do not publish a contact address that is
          not yet monitored.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
