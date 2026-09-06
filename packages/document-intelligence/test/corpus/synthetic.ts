/**
 * Synthetic corpus — invented clinics, practitioners and numbers; printed text only.
 * See README.md in this folder: the consented corpus is never committed.
 */
import type { DocumentKind } from "../../src/index.js";

export interface ClassifierFixture {
  id: string;
  kind: DocumentKind;
  lines: string[];
}

export const PRESCRIPTION_LINES = [
  "Sunrise Clinic, Banjara Hills, Hyderabad",
  "Dr. A. Verma, MBBS, MD (General Physician)",
  "Reg. No. TSMC/12345",
  "Date: 12/08/2026",
  "Patient: Test Patient  Age: 54 yrs",
  "Rx",
  "Tab. Glycomet 500 mg 1-0-1 after food x 30 days",
  "Tab. Amlong 5 mg OD before food",
  "Cap. Omez 20 mg",
  "1-0-0 empty stomach for 2 weeks",
  "Advice: rest and fluids",
  "Review on 12/09/2026",
];

export const LAB_REPORT_LINES = [
  "Precision Diagnostics Laboratory, Secunderabad",
  "Sample collected: 10/08/2026  Reported on: 11/08/2026",
  "Complete Blood Count",
  "Test Name  Result  Unit  Reference Range",
  "Haemoglobin 13.2 g/dL 13.0 - 17.0",
  "Total WBC Count 7800 cells/cumm 4000 - 11000",
  "Platelet Count 2,50,000 /cumm 1,50,000 - 4,50,000",
  "HbA1c 5.8 % 4.0 - 5.6 H",
  "Fasting Glucose 96 mg/dL (70 - 100)",
  "Vitamin D < 10 ng/mL 30 - 100 L",
  "Specimen: Whole blood EDTA",
  "Dr. S. Rao, MD (Pathologist)",
];

export const DISCHARGE_SUMMARY_LINES = [
  "Meadow Hospitals, Kukatpally",
  "DISCHARGE SUMMARY",
  "Date of Admission: 01/08/2026    Date of Discharge: 05/08/2026",
  "Consultant: Dr. P. Nair, MD, DM (Cardiologist)",
  "Hospital course: admitted with chest pain, managed conservatively.",
  "Condition at discharge: stable",
  "Discharge medications:",
  "Tab. Ecosprin 75 mg OD after food",
  "Tab. Atorva 40 mg HS",
  "Tab. Pantop 40 mg OD before food",
  "Review after 2 weeks",
];

/** A discharge summary written like a prescription: Rx, tab lines, frequency codes, advice (H-34 tie). */
export const DISCHARGE_LOOKS_LIKE_RX_LINES = [
  "Discharge Summary",
  "Rx",
  "Tab. Metolar 25 mg BD",
  "Tab. Ecosprin 75 mg OD",
  "Tab. Atorva 40 mg HS",
  "Tab. Pantop 40 mg OD",
  "Advice: low salt diet",
  "Reg. No. 4455",
];

export const CLASSIFIER_CORPUS: ClassifierFixture[] = [
  { id: "prescription-typical", kind: "prescription", lines: PRESCRIPTION_LINES },
  {
    id: "prescription-minimal",
    kind: "prescription",
    lines: ["Dr. R. Iyer MBBS", "Regn No 7788", "Dt 3/8/26", "℞", "Tab Dolo 650 SOS", "Syp Ascoril 5 ml TDS"],
  },
  { id: "lab-cbc", kind: "laboratory_report", lines: LAB_REPORT_LINES },
  {
    id: "lab-thyroid",
    kind: "laboratory_report",
    lines: ["Thyroid profile", "TSH 2.4 µIU/mL 0.4 - 4.0", "T3 1.1 ng/mL 0.8 - 2.0", "Biological reference interval as per kit insert"],
  },
  {
    id: "imaging-usg",
    kind: "imaging_report",
    lines: [
      "Radiant Imaging Centre",
      "USG Abdomen and Pelvis",
      "FINDINGS: Liver is normal in size and echotexture. No focal lesion.",
      "IMPRESSION: Normal study.",
      "Dr. K. Menon, MD (Radiologist)",
    ],
  },
  {
    id: "imaging-xray",
    kind: "imaging_report",
    lines: ["X-Ray Chest PA view", "Findings: lung fields are clear.", "Impression: no active lung pathology."],
  },
  { id: "discharge-typical", kind: "discharge_summary", lines: DISCHARGE_SUMMARY_LINES },
  { id: "discharge-looks-like-rx", kind: "discharge_summary", lines: DISCHARGE_LOOKS_LIKE_RX_LINES },
  {
    id: "consultation",
    kind: "consultation_note",
    lines: [
      "Consultation Note",
      "Chief complaint: cough for 5 days",
      "History of present illness: dry cough, no fever.",
      "On examination: chest clear",
      "Plan: symptomatic treatment",
    ],
  },
  {
    id: "vaccination",
    kind: "vaccination_record",
    lines: ["Immunisation Record", "Vaccine: Typhoid conjugate", "Dose 1 given on 02/02/2026", "Batch No: TC1122", "Next due: 02/02/2029"],
  },
  {
    id: "referral",
    kind: "referral",
    lines: ["Referral letter", "Referred to Dr. M. Das (Orthopaedic Surgeon) for expert opinion.", "Kindly see and advise."],
  },
  {
    id: "insurance",
    kind: "insurance",
    lines: ["Health Insurance Policy Schedule", "Policy No: HI-99887766", "Insured: Test Person", "Sum Insured: 5,00,000", "Premium: 12,000", "TPA: Sample TPA Ltd"],
  },
  {
    id: "invoice",
    kind: "invoice",
    lines: ["Tax Invoice", "GSTIN: 36AAAAA0000A1Z5", "Bill No: 1234", "Consultation charges Rs. 500", "CGST 9%  SGST 9%", "Total Amount: Rs. 590"],
  },
  {
    id: "packaging-strip",
    kind: "medicine_packaging",
    lines: ["Dolo 650", "Paracetamol Tablets IP 650 mg", "Mfd. by: Sample Pharma Ltd", "B.No. DL1234  Exp. 02/28", "Schedule H drug"],
  },
  {
    id: "packaging-short",
    kind: "medicine_packaging",
    lines: ["Amlong 5", "Amlodipine Tablets IP 5 mg", "Store in a cool dry place"],
  },
  {
    id: "other-letter",
    kind: "other",
    lines: ["Dear Sir,", "Please find attached the documents you requested last week.", "Regards,", "Front desk"],
  },
];
