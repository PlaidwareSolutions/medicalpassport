"use client";
import { useState } from "react";
import { ChoiceGrid, TextInput } from "@medpass/ui-web";
import { usePractitioners } from "../lib/practitioners";
import { useI18n } from "../lib/i18n";

const NEW_DOCTOR = "__new__";

/**
 * The standard way to say which doctor a medicine/prescription/report came
 * from (docs/07 screen 43 follow-up): existing doctors are one tap away,
 * typing a new name still works inline — nobody is ever forced through a
 * separate manage screen mid-flow. Reports the chosen/typed name (and, for
 * a newly typed doctor, an optional speciality) upward; parents keep
 * submitting the same plain name string their endpoints always took.
 */
export function DoctorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (name: string, speciality?: string) => void;
}) {
  const { t } = useI18n();
  const { items } = usePractitioners();
  const [speciality, setSpeciality] = useState("");
  // Sticky once the patient opts into typing, so clearing the name field
  // doesn't snap the inputs away under their fingers.
  const [typingNew, setTypingNew] = useState(false);

  const doctors = items ?? [];
  const matched = doctors.find((d) => d.displayName.toLowerCase() === value.trim().toLowerCase());
  const showInputs = typingNew || doctors.length === 0 || (value.trim() !== "" && !matched);

  if (doctors.length === 0) {
    // First doctor ever (or list still loading): just the inputs — the
    // picker must never block the form on a fetch.
    return (
      <NewDoctorInputs
        label={label}
        name={value}
        speciality={speciality}
        onName={(n) => onChange(n, speciality)}
        onSpeciality={(s) => {
          setSpeciality(s);
          onChange(value, s);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <ChoiceGrid
        label={label}
        columns={1}
        choices={[
          ...doctors.map((d) => ({
            value: d.id,
            label: d.speciality ? `${d.displayName} — ${d.speciality}` : d.displayName,
          })),
          { value: NEW_DOCTOR, label: t("doctors.new_choice") },
        ]}
        value={showInputs ? NEW_DOCTOR : matched?.id}
        onChange={(picked) => {
          if (picked === NEW_DOCTOR) {
            setTypingNew(true);
            onChange("", speciality);
            return;
          }
          setTypingNew(false);
          const doctor = doctors.find((d) => d.id === picked);
          if (doctor) onChange(doctor.displayName);
        }}
      />
      {showInputs ? (
        <NewDoctorInputs
          name={matched ? "" : value}
          speciality={speciality}
          onName={(n) => onChange(n, speciality)}
          onSpeciality={(s) => {
            setSpeciality(s);
            onChange(value, s);
          }}
        />
      ) : null}
    </div>
  );
}

function NewDoctorInputs({
  label,
  name,
  speciality,
  onName,
  onSpeciality,
}: {
  label?: string;
  name: string;
  speciality: string;
  onName: (name: string) => void;
  onSpeciality: (speciality: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <TextInput
        label={label ?? t("doctors.name_label")}
        placeholder={t("doctors.name_placeholder")}
        value={name}
        onChange={(e) => onName(e.target.value)}
      />
      <TextInput
        label={t("doctors.speciality_label")}
        placeholder={t("doctors.speciality_placeholder")}
        value={speciality}
        onChange={(e) => onSpeciality(e.target.value)}
      />
    </>
  );
}
