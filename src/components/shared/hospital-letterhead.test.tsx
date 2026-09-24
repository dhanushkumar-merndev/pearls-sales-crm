import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HospitalLetterhead } from "./hospital-letterhead";
import { HOSPITAL_IDENTITY_FALLBACK } from "@/lib/print/hospital-identity";

describe("HospitalLetterhead", () => {
  it("prints the tagline and every contact detail", () => {
    render(<HospitalLetterhead identity={HOSPITAL_IDENTITY_FALLBACK} />);
    expect(screen.getByText(HOSPITAL_IDENTITY_FALLBACK.tagline!)).toBeInTheDocument();
    expect(screen.getByText(HOSPITAL_IDENTITY_FALLBACK.address!)).toBeInTheDocument();
    expect(screen.getByText(HOSPITAL_IDENTITY_FALLBACK.phone!)).toBeInTheDocument();
    expect(screen.getByText(HOSPITAL_IDENTITY_FALLBACK.email!)).toBeInTheDocument();
  });

  it("uses the Pearl wordmark as the name and keeps the name for screen readers", () => {
    render(<HospitalLetterhead identity={HOSPITAL_IDENTITY_FALLBACK} />);
    expect(screen.getByAltText("Pearl Aesthetic & Wellness Clinic")).toBeInTheDocument();
    expect(screen.getByText("Pearl Aesthetic & Wellness Clinic")).toHaveClass("sr-only");
  });

  it("puts the identity block before the contact block", () => {
    const { container } = render(<HospitalLetterhead identity={HOSPITAL_IDENTITY_FALLBACK} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Pearl")).toBeLessThan(text.indexOf(HOSPITAL_IDENTITY_FALLBACK.address!));
    expect(text.indexOf(HOSPITAL_IDENTITY_FALLBACK.tagline!)).toBeLessThan(
      text.indexOf(HOSPITAL_IDENTITY_FALLBACK.phone!),
    );
  });

  it("prints a renamed clinic visibly and drops missing contact lines", () => {
    render(
      <HospitalLetterhead
        identity={{ name: "Pearl Skin Studio", tagline: null, address: null, phone: "+91 79008 02060", email: null }}
      />,
    );
    expect(screen.getByText("Pearl Skin Studio")).not.toHaveClass("sr-only");
    expect(screen.queryByText(HOSPITAL_IDENTITY_FALLBACK.tagline!)).not.toBeInTheDocument();
    expect(screen.getByText("+91 79008 02060")).toBeInTheDocument();
  });
});
