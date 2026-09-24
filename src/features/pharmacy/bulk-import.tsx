"use client";
import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { importMedicines } from "./actions";
import {
  MEDICINE_IMPORT_HEADERS,
  validateMedicineImportRows,
  type ImportErrorRow,
  type NormalizedMedicineImport,
} from "./import-schema";
import {
  buildErrorCsv,
  chunkKey,
  chunkRows,
  formatRowLimit,
  IMPORT_CHUNK_SIZE,
  MAX_IMPORT_ROWS,
  parseSpreadsheet,
} from "@/lib/domain/bulk-import";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SpreadsheetDropzone } from "@/components/shared/spreadsheet-dropzone";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
export function BulkMedicineImport() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  // Chunk progress, so a 10,000-row file does not look frozen.
  const [done, setDone] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [valid, setValid] = useState<NormalizedMedicineImport[]>([]);
  const [invalid, setInvalid] = useState<ImportErrorRow[]>([]);
  const [key, setKey] = useState(() => crypto.randomUUID());

  /**
   * The file is validated in one pass locally, then sent up in chunks: a server
   * action body cannot carry 10,000 rows. Each chunk is its own transaction
   * with its own idempotency key, so a mid-upload failure leaves the earlier
   * chunks committed and re-running skips them.
   */
  const runImport = async () => {
    setPending(true);
    setResult(null);
    setDone(0);
    // Chunks carry the raw spreadsheet rows: the server action re-validates and
    // normalises them itself rather than trusting the browser's output.
    const chunks = chunkRows(rawRows);
    let created = 0;
    let newBatches = 0;
    let updatedBatches = 0;
    try {
      for (const [index, chunk] of chunks.entries()) {
        const payload = new FormData();
        payload.set(
          "fileName",
          chunks.length > 1 ? `${fileName} (part ${index + 1} of ${chunks.length})` : fileName,
        );
        payload.set("rows", JSON.stringify(chunk));
        // Derive a per-chunk UUID from the file's key: same file re-uploaded
        // after a failure produces the same keys, so committed chunks are
        // recognised as replays instead of importing twice.
        payload.set("idempotencyKey", chunkKey(key, index));
        const response = await importMedicines({ ok: false }, payload);
        if (!response.ok) {
          setResult({
            ok: false,
            message: `${response.message ?? "Import failed."} ${index} of ${chunks.length} batches were committed before this failure.`,
          });
          return;
        }
        const data = (response.data ?? {}) as Record<string, number>;
        created += Number(data.created_medicines ?? 0);
        newBatches += Number(data.new_batches ?? 0);
        updatedBatches += Number(data.updated_batches ?? 0);
        setDone(Math.min(valid.length, (index + 1) * IMPORT_CHUNK_SIZE));
      }
      setResult({
        ok: true,
        message: `Imported ${valid.length} rows: ${created} new medicines, ${newBatches} new batches, ${updatedBatches} batches topped up.`,
      });
    } finally {
      setPending(false);
    }
  };
  const parseFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    try {
      const rows = await parseSpreadsheet(file);
      const checked = validateMedicineImportRows(rows);
      setFileName(file.name);
      setRawRows(rows);
      setValid(checked.valid);
      setInvalid(checked.invalid);
      setKey(crypto.randomUUID());
    } catch (error) {
      setFileName(file.name);
      setRawRows([]);
      setValid([]);
      setInvalid([
        {
          row: 1,
          data: {},
          errors: [(error as Error).message ||
            "The spreadsheet could not be read. Use the official template."],
        },
      ]);
    } finally {
      setParsing(false);
    }
  };
  const downloadErrors = () => {
    const content = buildErrorCsv(MEDICINE_IMPORT_HEADERS, invalid);
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "medicine-import-errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              1. Download official template
            </CardTitle>
            <CardDescription>
              Headers, example data, and instructions are included.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              render={<a href="/api/pharmacy/import/template" />}
            >
              <Download /> Download Excel Template
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Upload Excel or CSV</CardTitle>
            <CardDescription>
              Up to {formatRowLimit(MAX_IMPORT_ROWS)} medicine and batch rows per file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpreadsheetDropzone onFile={parseFile} disabled={parsing || pending} />
          </CardContent>
        </Card>
      </div>
      {parsing ? <Progress value={60} /> : null}
      {fileName ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Validation summary · {fileName}
            </CardTitle>
            <CardDescription>
              Rows are not imported until you confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Rows in file</p>
                <p className="text-2xl font-semibold">{rawRows.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Valid</p>
                <p className="text-2xl font-semibold text-primary">
                  {valid.length}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Invalid</p>
                <p className="text-2xl font-semibold text-destructive">
                  {invalid.length}
                </p>
              </div>
            </div>
            {invalid.length ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Invalid rows will not be imported</AlertTitle>
                <AlertDescription>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={downloadErrors}
                  >
                    <Download /> Download Error Rows
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>All rows are valid</AlertTitle>
                <AlertDescription>
                  Review the preview, then confirm the transactional import.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Medicine</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Selling Price</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {valid.slice(0, 100).map((row, index) => (
                    <TableRow
                      key={`${row.medicine_name}-${row.batch_number}-${index}`}
                    >
                      <TableCell>{index + 2}</TableCell>
                      <TableCell>{row.medicine_name}</TableCell>
                      <TableCell>{row.batch_number}</TableCell>
                      <TableCell>{row.expiry_date}</TableCell>
                      <TableCell>{row.opening_quantity}</TableCell>
                      <TableCell>
                        ₹{(row.selling_price_paise / 100).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-primary">Valid</TableCell>
                    </TableRow>
                  ))}
                  {invalid.slice(0, 50).map((row) => (
                    <TableRow key={`invalid-${row.row}`}>
                      <TableCell>{row.row}</TableCell>
                      <TableCell>
                        {String(row.data.medicine_name ?? "—")}
                      </TableCell>
                      <TableCell>
                        {String(row.data.batch_number ?? "—")}
                      </TableCell>
                      <TableCell>
                        {String(row.data.expiry_date ?? "—")}
                      </TableCell>
                      <TableCell>
                        {String(row.data.opening_quantity ?? "—")}
                      </TableCell>
                      <TableCell>
                        {String(row.data.selling_price ?? "—")}
                      </TableCell>
                      <TableCell className="max-w-72 text-destructive">
                        {row.errors.join("; ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {result ? (
              <Alert variant={result.ok ? "default" : "destructive"}>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>
            ) : null}
            {pending && valid.length > IMPORT_CHUNK_SIZE ? (
              <div className="space-y-1">
                <Progress value={(done / valid.length) * 100} />
                <p className="text-xs text-muted-foreground">
                  Imported {done.toLocaleString("en-IN")} of {valid.length.toLocaleString("en-IN")} rows
                </p>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                disabled={pending || invalid.length > 0 || valid.length === 0}
                type="button"
                onClick={runImport}
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Upload />
                )}{" "}
                Import {valid.length.toLocaleString("en-IN")} Valid Rows
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
