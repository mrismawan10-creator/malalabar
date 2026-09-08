import type { StaffRole } from "./auth.js";

export interface StaffLoginRequest {
  email: string;
  password: string;
}

export interface StaffLoginResponse {
  token: string;
  staff: {
    id: string;
    name: string;
    email: string;
    role: StaffRole;
    mustReset: boolean;
  };
}
