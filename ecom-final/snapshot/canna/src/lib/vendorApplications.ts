// In-memory vendor application store. Captures a state licence number and holds
// the application in a manual licence-validity check (a hard gate) until an
// admin approves it. No automated lookup against the state register for MVP.

export type VendorApplicationStatus = "submitted" | "licence_check_pending" | "approved" | "rejected";

export interface VendorApplication {
  id: string;
  businessName: string;
  stateLicenceNumber: string;
  issuingState: string;
  licenceExpiry: string;
  status: VendorApplicationStatus;
  createdAt: string;
  reviewedAt?: string;
}

export interface VendorApplicationInput {
  businessName: string;
  stateLicenceNumber: string;
  issuingState: string;
  licenceExpiry: string;
}

const applications: VendorApplication[] = [];

export function listApplications(): VendorApplication[] {
  return applications.map((a) => ({ ...a }));
}

/**
 * Submit a vendor application. It immediately enters `licence_check_pending`
 * because admin approval requires a manual licence-validity check as a hard
 * gate before the vendor may list products.
 */
export function submitApplication(input: VendorApplicationInput): VendorApplication {
  if (!input.businessName || !input.stateLicenceNumber || !input.issuingState || !input.licenceExpiry) {
    throw new Error("businessName, stateLicenceNumber, issuingState and licenceExpiry are required");
  }
  const application: VendorApplication = {
    id: `app_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    businessName: input.businessName,
    stateLicenceNumber: input.stateLicenceNumber,
    issuingState: input.issuingState.toUpperCase(),
    licenceExpiry: input.licenceExpiry,
    status: "licence_check_pending",
    createdAt: new Date().toISOString(),
  };
  applications.push(application);
  return { ...application };
}

/** Admin approval after the manual licence check. */
export function approveApplication(id: string): VendorApplication | undefined {
  const app = applications.find((a) => a.id === id);
  if (!app) return undefined;
  app.status = "approved";
  app.reviewedAt = new Date().toISOString();
  return { ...app };
}

/** Admin rejection after the manual licence check. */
export function rejectApplication(id: string, note?: string): VendorApplication | undefined {
  const app = applications.find((a) => a.id === id);
  if (!app) return undefined;
  app.status = "rejected";
  app.reviewedAt = new Date().toISOString();
  return { ...app };
}
