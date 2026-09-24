import { AlertCircle, CheckCircle2, Database } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center p-4 sm:p-8">
      <Card className="w-full shadow-sm">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Database className="size-5" />
          </div>
          <CardTitle>Connect Pearl Aesthetic & Wellness Clinic</CardTitle>
          <CardDescription>The application is installed. Complete the private database connection to sign in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>Environment configuration required</AlertTitle>
            <AlertDescription>Copy <code>.env.example</code> to <code>.env.local</code> and add your Supabase project values.</AlertDescription>
          </Alert>
          <ol className="space-y-3 text-sm">
            {[
              "Run pnpm db:start for local development, or link a hosted Supabase project.",
              "Run pnpm db:reset locally (or pnpm db:push for the linked project).",
              "Create the first admin using the documented server-only bootstrap command.",
              "Restart pnpm dev, then open /login.",
            ].map((item, index) => (
              <li className="flex gap-3" key={item}>
                <Badge variant="secondary" className="size-6 justify-center rounded-full p-0">{index + 1}</Badge>
                <span>{item}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" /> Secrets are intentionally not bundled with this repository.
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
