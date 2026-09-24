import { describe, expect, it } from "vitest";
import { productionEnvironmentProblems } from "@/lib/production-env";

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  NEXT_PUBLIC_APP_URL: "https://hospital.example",
  APP_TIMEZONE: "Asia/Kolkata",
  PATIENT_DOCUMENT_MAX_BYTES: "1048576",
  EXPORT_RETENTION_DAYS: "7",
};

describe("productionEnvironmentProblems", () => {
  it("accepts a complete HTTPS production environment", () => {
    expect(productionEnvironmentProblems(validEnvironment)).toEqual([]);
  });

  it("rejects missing secrets and non-HTTPS public URLs", () => {
    const problems = productionEnvironmentProblems({
      ...validEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "",
      NEXT_PUBLIC_APP_URL: "http://hospital.example/app",
    });

    expect(problems).toContain("SUPABASE_SERVICE_ROLE_KEY is required.");
    expect(problems).toContain("NEXT_PUBLIC_APP_URL must use HTTPS outside localhost.");
    expect(problems).toContain(
      "NEXT_PUBLIC_APP_URL must be an origin without a path, query, or fragment.",
    );
  });

  it("requires WHO credentials as a pair", () => {
    expect(
      productionEnvironmentProblems({ ...validEnvironment, WHOS_CLIENT: "client" }),
    ).toContain("WHOS_CLIENT and WHOS_SECRET must either both be set or both be empty.");
  });
});
