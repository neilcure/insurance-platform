export type PackagesSnapshot = Record<
  string,
  | { category?: string | number | boolean; values?: Record<string, unknown> }
  | Record<string, unknown>
>;

export type PolicyDetail = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  carId: number | null;
  clientId?: number | null;
  plateNumber?: string | null;
  plateNo?: string | null;
  plate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: string | number | null;
  extraAttributes?: {
    packagesSnapshot?: PackagesSnapshot;
    insuredSnapshot?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  client?: { id: number; clientNumber?: string; createdAt?: string } | null;
  agent?: { id: number; userNumber?: string | null; name?: string | null; email?: string } | null;
};
