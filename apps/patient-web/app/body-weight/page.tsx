import { redirect } from "next/navigation";

/** The V1 diary route — its readings now live on the Measurements hub (docs_v2/06 P5-3). */
export default function LegacyDiaryRedirect() {
  redirect("/measurements/body_weight");
}
