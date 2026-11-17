export async function request<T>(path: string, token: string | null, method = "GET", payload?: object) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(payload && { "Content-Type": "application/json" }),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message = typeof result?.detail === "string"
      ? result.detail
      : "The request could not be completed.";
    throw new Error(message);
  }
  return result as T;
}
