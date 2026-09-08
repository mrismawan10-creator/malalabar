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

export interface KitchenDeviceLoginRequest {
  deviceId: string;
  token: string;
}

export interface KitchenDeviceLoginResponse {
  token: string;
  device: {
    id: string;
    label: string;
  };
}
