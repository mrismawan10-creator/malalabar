import type { StaffRepository, StaffUserRow } from "../repositories/staff.repository.js";

export function createFakeStaffRepository(): StaffRepository {
  const users: StaffUserRow[] = [
    {
      id: "staff-cashier-1",
      name: "Budi Kasir",
      email: "budi@malalabar.com",
      passwordHash:
        "$2a$10$x/2Pp8rLbJJqpN8KsK3FZeE5c2zqJQQVqrQzlVQo7DduK5VKJHkti", // "password123"
      role: "CASHIER",
      isSuspended: false,
      mustReset: false,
      lastLoginAt: null,
    },
  ];

  return {
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },

    async updateLastLogin(id) {
      const user = users.find((u) => u.id === id);
      if (user) {
        user.lastLoginAt = new Date();
      }
    },
  };
}
