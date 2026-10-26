import Link from "next/link";
import { Card } from "@/components/ui";
import { CredentialsForm } from "@/components/CredentialsForm";

export const metadata = { title: "Family sign in" };

export default function FamilyLogin() {
  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">Family sign in</h1>
      <CredentialsForm redirectTo="/family" />
      <p className="mt-4 text-sm text-slate-600">
        New here? <Link className="text-blue-800 underline" href="/family/signup">Create an account</Link>
      </p>
    </Card>
  );
}
