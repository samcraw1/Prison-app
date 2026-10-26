import { Suspense } from "react";
import { KioskLogin } from "./KioskLogin";

export const metadata = { title: "Resident sign in" };

export default function ResidentLogin() {
  return (
    <Suspense>
      <KioskLogin />
    </Suspense>
  );
}
