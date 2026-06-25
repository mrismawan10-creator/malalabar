/**
 * Pagination wrapper — API_Contract §1.3
 * Query: ?page=1&pageSize=20
 */
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
