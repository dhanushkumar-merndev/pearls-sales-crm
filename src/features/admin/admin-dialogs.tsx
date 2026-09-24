"use client";
import { useActionState, useState } from "react";
import { LoaderCircle, Plus, UserCog } from "lucide-react";
import { createDoctor, createStaffUser, updateDoctor, updateStaffUser } from "./actions";
import { ROLE_LABELS, STAFF_ROLES, type ActionState } from "@/types/hospital";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";
import { DeleteMasterButton, DeleteStaffButton } from "./delete-master-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const initial: ActionState = { ok: false };
const FieldError = ({ errors }: { errors?: string[] }) => (
  <>
    {errors?.map((e) => (
      <p className="text-xs text-destructive" key={e}>
        {e}
      </p>
    ))}
  </>
);
export function AddUserDialog() {
  const [state, action, pending] = useActionState(createStaffUser, initial);
  const [role, setRole] = useState("reception");
  const { open, setOpen } = useAutoCloseDialog(state, "Staff user created.");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> Add User
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Add staff user</DialogTitle>
            <DialogDescription>
              The temporary password is sent only to Supabase Auth and is never
              stored in hospital tables.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="role" value={role} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full-name">Name</Label>
              <Input id="full-name" name="fullName" required />
              <FieldError errors={state.fieldErrors?.fullName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
              <FieldError errors={state.fieldErrors?.email} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Temporary password</Label>
              <Input id="password" name="password" type="password" required />
              <FieldError errors={state.fieldErrors?.password} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {ROLE_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending} type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <UserCog />
              )}{" "}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function AddDoctorDialog({
  departments,
}: {
  departments: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(createDoctor, initial);
  const [department, setDepartment] = useState(departments[0]?.id ?? "");
  const { open, setOpen } = useAutoCloseDialog(state, "Doctor created.");
  const departmentName =
    departments.find((item) => item.id === department)?.name ??
    "Select department";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> Add Doctor
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Add doctor</DialogTitle>
            <DialogDescription>
              Creates and links the Auth account, staff profile, and doctor fees
              as one workflow.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="departmentId" value={department} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["fullName", "Name", "text"],
              ["email", "Email", "email"],
              ["password", "Temporary password", "password"],
              ["qualification", "Qualification", "text"],
              ["specialization", "Specialization", "text"],
              ["registrationNumber", "Registration number", "text"],
              ["opFee", "OP fee", "text"],
              ["followUpFee", "Follow-up fee", "text"],
            ].map(([name, label, type]) => (
              <div className="space-y-2" key={name}>
                <Label htmlFor={`doctor-${name}`}>{label}</Label>
                <Input
                  id={`doctor-${name}`}
                  name={name}
                  type={type}
                  required={[
                    "fullName",
                    "email",
                    "password",
                    "registrationNumber",
                    "opFee",
                    "followUpFee",
                  ].includes(name)}
                />
                <FieldError errors={state.fieldErrors?.[name]} />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="add-doctor-department">Department</Label>
              <Select
                value={department}
                onValueChange={(value) => setDepartment(String(value))}
              >
                <SelectTrigger id="add-doctor-department" className="w-full">
                  <SelectValue placeholder="Select department">
                    {() => departmentName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id} label={d.name}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending || !department} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Create Doctor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditStaffDialog({ user }: { user: { id: string; fullName: string; role: string; status: string } }) {
  const [state, action, pending] = useActionState(updateStaffUser, initial);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const { open, setOpen } = useAutoCloseDialog(state, "Staff account updated.");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Edit</DialogTrigger>
      <DialogContent>
        <form action={action} className="contents">
          <DialogHeader><DialogTitle>Edit staff user</DialogTitle><DialogDescription>Deactivate staff instead of deleting historical accounts. A password is changed only when entered.</DialogDescription></DialogHeader>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="status" value={status} />
          {state.message && !state.ok ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.message}</p> : null}
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor={`staff-name-${user.id}`}>Name</Label><Input id={`staff-name-${user.id}`} name="fullName" defaultValue={user.fullName} required /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Role</Label><Select value={role} onValueChange={(value) => setRole(value as string)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{STAFF_ROLES.map((value) => <SelectItem key={value} value={value}>{ROLE_LABELS[value]}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Status</Label><Select value={status} onValueChange={(value) => setStatus(value as string)}><SelectTrigger className="w-full"><SelectValue>{() => (status === "active" ? "Active" : "Inactive")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label htmlFor={`staff-password-${user.id}`}>New password (optional)</Label><Input id={`staff-password-${user.id}`} name="password" type="password" minLength={10} /></div>
          </div>
          <DialogFooter showCloseButton><DeleteStaffButton id={user.id} label={user.fullName} /><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : <UserCog />} Save Changes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditDoctorDialog({ doctor, departments, triggerLabel = "Edit" }: { doctor: { id: string; displayName: string; departmentId: string; specialization: string | null; qualification: string | null; registrationNumber: string; opFee: string; followUpFee: string; active: boolean }; departments: Array<{ id: string; name: string }>; triggerLabel?: string }) {
  const [state, action, pending] = useActionState(updateDoctor, initial);
  const [department, setDepartment] = useState(doctor.departmentId);
  const { open, setOpen } = useAutoCloseDialog(state, "Doctor updated.");
  const departmentName =
    departments.find((item) => item.id === department)?.name ??
    "Select department";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <form action={action} className="contents">
          <DialogHeader><DialogTitle>Edit doctor</DialogTitle><DialogDescription>Update professional details, fees, department, and availability.</DialogDescription></DialogHeader>
          <input type="hidden" name="doctorId" value={doctor.id} /><input type="hidden" name="departmentId" value={department} />
          {state.message && !state.ok ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.message}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {[["displayName", "Name", doctor.displayName], ["qualification", "Qualification", doctor.qualification ?? ""], ["specialization", "Specialization", doctor.specialization ?? ""], ["registrationNumber", "Registration number", doctor.registrationNumber], ["opFee", "OP fee", doctor.opFee], ["followUpFee", "Follow-up fee", doctor.followUpFee]].map(([name, label, value]) => <div className="space-y-2" key={name}><Label htmlFor={`${name}-${doctor.id}`}>{label}</Label><Input id={`${name}-${doctor.id}`} name={name} defaultValue={value} required={["displayName", "registrationNumber", "opFee", "followUpFee", "ipFee"].includes(name)} /></div>)}
            <div className="space-y-2"><Label htmlFor={`edit-doctor-department-${doctor.id}`}>Department</Label><Select value={department} onValueChange={(value) => setDepartment(String(value))}><SelectTrigger id={`edit-doctor-department-${doctor.id}`} className="w-full"><SelectValue placeholder="Select department">{() => departmentName}</SelectValue></SelectTrigger><SelectContent>{departments.map((item) => <SelectItem key={item.id} value={item.id} label={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <label className="flex items-center gap-2 self-end text-sm"><Checkbox name="active" defaultChecked={doctor.active} /> Active</label>
          </div>
          <DialogFooter showCloseButton><DeleteMasterButton entity="doctor" id={doctor.id} label={doctor.displayName} /><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : <UserCog />} Save Doctor</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
