"use client";

import { useActionState, useState } from "react";
import { Archive, Download, LoaderCircle, Trash2 } from "lucide-react";
import { deleteMonthlyExport, generateMonthlyExport } from "./actions";
import type { ActionState } from "@/types/hospital";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExportGenerator({ defaultMonth }: { defaultMonth: string }) {
  const [state, action, pending] = useActionState(generateMonthlyExport, { ok: false } as ActionState); const [documents, setDocuments] = useState(false);
  return <Card className="mb-5"><CardHeader><CardTitle className="text-base">Generate monthly ZIP</CardTitle><CardDescription>Data Only is recommended for routine monthly archives. Data + Documents also duplicates monthly uploaded files.</CardDescription></CardHeader><CardContent><form action={action} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="export-month">Month</Label><Input id="export-month" name="month" type="month" defaultValue={defaultMonth} required /></div><label className="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox name="includeDocuments" checked={documents} onCheckedChange={(value) => setDocuments(Boolean(value))} /><span><span className="block font-medium">Data + uploaded documents</span><span className="text-xs text-muted-foreground">Leave off for the smaller Data Only ZIP.</span></span></label></div>{state.message ? <Alert variant={state.ok ? "default" : "destructive"}><AlertDescription>{state.message}</AlertDescription></Alert> : null}<Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : <Archive />} Generate Export</Button></form></CardContent></Card>;
}

export function ExportActions({ id, ready }: { id: string; ready: boolean }) {
  return <div className="flex justify-end gap-1">{ready ? <Button size="sm" variant="outline" render={<a href={`/api/exports/${id}`} />}><Download /> Download</Button> : null}{ready ? <AlertDialog><AlertDialogTrigger render={<Button size="sm" variant="ghost" />}><Trash2 /> Delete ZIP</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this generated ZIP?</AlertDialogTitle><AlertDialogDescription>This removes only the temporary export file. It never deletes patients, visits, reports, prescriptions, payments, pharmacy records, or IP records.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><form action={deleteMonthlyExport}><input type="hidden" name="id" value={id} /><AlertDialogAction type="submit">Delete ZIP Only</AlertDialogAction></form></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}</div>;
}
