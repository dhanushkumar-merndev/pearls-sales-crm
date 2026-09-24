import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type BucketUsage = {
  bucket_id: string;
  object_count: number;
  total_bytes: number;
  quota_bytes: number | null;
};

/** Supabase free tier ships 1 GB of storage; used when a bucket has no explicit cap. */
const DEFAULT_PLAN_BYTES = 1024 ** 3;
const DEFAULT_DATABASE_PLAN_BYTES = 500 * 1024 ** 2;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function UsageRing({ percent, label }: { percent: number; label: string }) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 90 ? "var(--destructive)" : clamped >= 75 ? "var(--chart-4)" : "var(--primary)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${clamped.toFixed(1)} percent used`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">
          {clamped < 1 && clamped > 0 ? "<1" : Math.round(clamped)}%
        </span>
        <span className="text-[11px] text-muted-foreground">used</span>
      </div>
    </div>
  );
}

export function StorageUsage({
  buckets,
  databaseBytes,
}: {
  buckets: BucketUsage[];
  databaseBytes: number | null;
}) {
  const patient = buckets.find((b) => b.bucket_id === "patient-documents");
  const totalUsed = buckets.reduce((sum, b) => sum + Number(b.total_bytes ?? 0), 0);
  const totalObjects = buckets.reduce((sum, b) => sum + Number(b.object_count ?? 0), 0);
  const capacity = DEFAULT_PLAN_BYTES;
  const percent = capacity > 0 ? (totalUsed / capacity) * 100 : 0;
  const databaseUsed = Math.max(0, Number(databaseBytes ?? 0));
  const databasePercent = (databaseUsed / DEFAULT_DATABASE_PLAN_BYTES) * 100;
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="text-base">Storage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <UsageRing percent={percent} label="File storage used" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">File storage</p>
              <p className="text-sm font-medium">
                {formatBytes(totalUsed)} of {formatBytes(capacity)} used
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(Math.max(0, capacity - totalUsed))} remaining ·{" "}
                {totalObjects.toLocaleString("en-IN")} file
                {totalObjects === 1 ? "" : "s"} stored
              </p>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-2">
                <dt className="text-xs text-muted-foreground">Patient documents</dt>
                <dd className="font-medium tabular-nums">
                  {formatBytes(Number(patient?.total_bytes ?? 0))}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({Number(patient?.object_count ?? 0).toLocaleString("en-IN")} files)
                  </span>
                </dd>
              </div>
              <div className="rounded-md border p-2">
                <dt className="text-xs text-muted-foreground">Other buckets</dt>
                <dd className="font-medium tabular-nums">
                  {formatBytes(totalUsed - Number(patient?.total_bytes ?? 0))}
                </dd>
              </div>
            </dl>
            {percent >= 75 ? (
              <p className="text-xs text-destructive">
                File storage is filling up. Delete old generated export ZIPs from
                Monthly Export — that never removes patient records.
              </p>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col items-center gap-6  pt-6 sm:flex-row sm:items-center lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <UsageRing percent={databasePercent} label="Database storage used" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Database storage
              </p>
              {databaseBytes === null ? (
                <p className="text-sm font-medium">Usage unavailable</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {formatBytes(databaseUsed)} of{" "}
                    {formatBytes(DEFAULT_DATABASE_PLAN_BYTES)} used
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(
                      Math.max(0, DEFAULT_DATABASE_PLAN_BYTES - databaseUsed),
                    )}{" "}
                    remaining
                  </p>
                </>
              )}
            </div>
            <div className="rounded-md border p-2 text-sm">
              <p className="text-xs text-muted-foreground">PostgreSQL database</p>
              <p className="font-medium">Tables, indexes, and database metadata</p>
            </div>
            {databaseBytes !== null && databasePercent >= 75 ? (
              <p className="text-xs text-destructive">
                Database storage is filling up. Review retention and plan capacity
                before the quota is reached.
              </p>
            ) : null}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
