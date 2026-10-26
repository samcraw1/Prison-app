import { Card } from "@/components/ui";
import { CredentialsForm } from "@/components/CredentialsForm";

export const metadata = { title: "Staff sign in" };

export default function StaffLogin() {
  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">Staff sign in</h1>
      <CredentialsForm redirectTo="/staff" />
    </Card>
  );
}
