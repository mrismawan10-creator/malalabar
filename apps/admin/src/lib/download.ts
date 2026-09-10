import { config } from "@/config";

/**
 * Downloads an authed binary (report PDF/CSV) and hands the browser a file,
 * taking the filename from the server's Content-Disposition when present.
 */
export async function downloadAuthed(
  path: string,
  token: string,
  fallbackName: string,
): Promise<void> {
  const res = await fetch(`${config.apiBaseUrl}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "Gagal mengunduh file");
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
