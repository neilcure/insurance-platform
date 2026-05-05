export type AgentDetail = {
  id: number;
  userNumber: string | null;
  email: string;
  mobile?: string | null;
  name: string | null;
  profileMeta?: {
    accountType?: "personal" | "company";
    companyName?: string | null;
    primaryId?: string | null;
  } | null;
  userType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};
