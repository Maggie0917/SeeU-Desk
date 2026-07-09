import { AuthForm } from "@/components/AuthForm";
import { DatabaseUnavailableNotice } from "@/components/DatabaseUnavailableNotice";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseUnavailableError } from "@/lib/db-with-retry";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <DatabaseUnavailableNotice />;
    throw error;
  }
  if (user) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <AuthForm mode="login" />
    </main>
  );
}
