import { CLINIC_NAME, HospitalWordmark } from "@/components/shared/hospital-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <main className="login-bg flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md border-border bg-card/95 shadow-lg backdrop-blur-sm">
        <CardHeader className="pb-4 text-center">
          <HospitalWordmark height={40} className="mx-auto mb-2 py-4 h-auto w-32 max-w-full" />
          <CardTitle className="sr-only">{CLINIC_NAME}</CardTitle>
          <CardDescription className="font-display text-base text-muted-foreground">Sign in with your staff account</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6"><LoginForm next={next} /></CardContent>
      </Card>
    </main>
  );
}
