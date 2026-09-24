"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Upload } from "lucide-react";
import {
  buildErrorCsv,
  chunkKey,
  chunkRows,
  formatRowLimit,
  IMPORT_CHUNK_SIZE,
  MAX_IMPORT_ROWS,
  parseSpreadsheet,
  type ImportErrorRow,
} from "@/lib/domain/bulk-import";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SpreadsheetDropzone } from "@/components/shared/spreadsheet-dropzone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ImportChunkResult = { ok: boolean; message?: string };

/**
 * Download template -> fill in -> drop the file -> validate in the browser ->
 * preview -> confirm -> import in chunks.
 *
 * Validation runs entirely on the client so a 10,000-row file gives instant
 * row-by-row feedback without touching the server, and nothing is written until
 * the operator confirms. The upload then goes up in transaction-sized chunks
 * (a server action body cannot carry the whole file) with a progress bar and a
 * per-chunk idempotency key.
 */
export function BulkImportPanel<Row>({
  title,
  description,
  templateHref,
  headers,
  validate,
  importChunk,
  columns,
  errorFileName,
}: {
  title: string;
  description: string;
  templateHref: string;
  headers: readonly string[];
  validate: (rows: unknown[]) => { valid: Row[]; invalid: ImportErrorRow[] };
  /**
   * Sends one chunk of the ORIGINAL spreadsheet rows. The server re-validates
   * and normalises them itself -- it must never trust a shape the browser
   * produced.
   */
  importChunk: (rows: unknown[], fileName: string, idempotencyKey: string) => Promise<ImportChunkResult>;
  /** Preview columns: label plus how to read the value off a valid row. */
  columns: Array<{ label: string; value: (row: Row) => string; key: string }>;
  errorFileName: string;
}) {
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [valid, setValid] = useState<Row[]>([]);
  const [invalid, setInvalid] = useState<ImportErrorRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const parseFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    setResult(null);
    try {
      const rows = await parseSpreadsheet(file);
      const checked = validate(rows);
      setFileName(file.name);
      setRawRows(rows);
      setValid(checked.valid);
      setInvalid(checked.invalid);
      setKey(crypto.randomUUID());
    } catch (error) {
      setFileName(file.name);
      setRawRows([]);
      setValid([]);
      setInvalid([{
        row: 1,
        data: {},
        errors: [(error as Error).message || "The file could not be read. Use the official template."],
      }]);
    } finally {
      setParsing(false);
    }
  };

  const downloadErrors = () => {
    const url = URL.createObjectURL(new Blob([buildErrorCsv(headers, invalid)], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = errorFileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    setPending(true);
    setResult(null);
    setDone(0);
    // Import is blocked while any row is invalid, so the raw rows and the
    // validated rows are the same set in the same order.
    const chunks = chunkRows(rawRows);
    try {
      for (const [index, chunk] of chunks.entries()) {
        const label = chunks.length > 1 ? `${fileName} (part ${index + 1} of ${chunks.length})` : fileName;
        const response = await importChunk(chunk, label, chunkKey(key, index));
        if (!response.ok) {
          setResult({
            ok: false,
            message: `${response.message ?? "Import failed."} ${done.toLocaleString("en-IN")} rows were committed before this point; re-uploading the same file will resume without duplicating them.`,
          });
          return;
        }
        setDone(Math.min(valid.length, (index + 1) * IMPORT_CHUNK_SIZE));
      }
      setResult({ ok: true, message: `Imported ${valid.length.toLocaleString("en-IN")} rows.` });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Download official template</CardTitle>
            <CardDescription>Headers, an example row, and instructions are included.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<a href={templateHref} />}>
              <Download /> Download Excel Template
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Upload Excel or CSV</CardTitle>
            <CardDescription>
              {description} Up to {formatRowLimit(MAX_IMPORT_ROWS)} rows per file.
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
              {title} · {fileName}
            </CardTitle>
            <CardDescription>Nothing is saved until you confirm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Rows in file</p>
                <p className="text-2xl font-semibold">{rawRows.length.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Valid</p>
                <p className="text-2xl font-semibold text-primary">{valid.length.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Invalid</p>
                <p className="text-2xl font-semibold text-destructive">{invalid.length.toLocaleString("en-IN")}</p>
              </div>
            </div>

            {invalid.length ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Invalid rows will not be imported</AlertTitle>
                <AlertDescription>
                  <Button className="mt-2" size="sm" variant="outline" type="button" onClick={downloadErrors}>
                    <Download /> Download Error Rows
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>All rows are valid</AlertTitle>
                <AlertDescription>Review the preview, then confirm the import.</AlertDescription>
              </Alert>
            )}

            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Row</TableHead>
                    {columns.map((column) => (
                      <TableHead key={column.key}>{column.label}</TableHead>
                    ))}
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Only the first 100 rows are rendered: a 10,000-row table
                      would lock the browser and tells the operator nothing more. */}
                  {valid.slice(0, 100).map((row, index) => (
                    <TableRow key={`valid-${index}`}>
                      <TableCell>{index + 2}</TableCell>
                      {columns.map((column) => (
                        <TableCell key={column.key}>{column.value(row)}</TableCell>
                      ))}
                      <TableCell className="text-primary">Valid</TableCell>
                    </TableRow>
                  ))}
                  {invalid.slice(0, 50).map((row) => (
                    <TableRow key={`invalid-${row.row}`}>
                      <TableCell>{row.row}</TableCell>
                      {columns.map((column) => (
                        <TableCell key={column.key}>{String(row.data[column.key] ?? "—")}</TableCell>
                      ))}
                      <TableCell className="max-w-72 text-destructive">{row.errors.join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {valid.length > 100 || invalid.length > 50 ? (
              <p className="text-xs text-muted-foreground">
                Showing the first 100 valid and 50 invalid rows. Every row in the file is still validated and imported.
              </p>
            ) : null}

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
              <Button disabled={pending || invalid.length > 0 || valid.length === 0} type="button" onClick={runImport}>
                {pending ? <LoaderCircle className="animate-spin" /> : <Upload />} Import{" "}
                {valid.length.toLocaleString("en-IN")} Valid Rows
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
